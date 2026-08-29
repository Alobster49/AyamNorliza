-- 20260901000001_dynamic_rbac_schema.sql
--
-- Dynamic RBAC: org-scoped roles + per-page CRUD permissions, replacing the
-- hardcoded `organization_members.role` text enum as the source of truth.
-- Seed mirrors DEFAULT_ROLE_GRANTS in src/lib/auth/rbac.ts grant-for-grant
-- (rbac.test.ts is the parity gate against the legacy matrix).
--
-- `role` (text) and the new `role_id` (uuid) are kept in sync by triggers
-- during the transition; later migrations can drop `role` once every caller
-- reads role_id/has_permission instead of has_org_role.

begin;

-- ---------------------------------------------------------------------------
-- organization_roles / role_permissions
-- ---------------------------------------------------------------------------
create table if not exists public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  rank int not null default 10,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.organization_roles(id) on delete cascade,
  resource text not null,
  action text not null check (action in ('view','add','edit','delete','use')),
  granted boolean not null default true,
  primary key (role_id, resource, action)
);

grant select, insert, update, delete on public.organization_roles to authenticated;
grant select, insert, update, delete on public.role_permissions to authenticated;

alter table public.organization_roles enable row level security;
alter table public.role_permissions enable row level security;

-- role_id columns are added early (nullable) so has_permission and the RLS
-- policies below can reference organization_members.role_id: LANGUAGE SQL
-- function bodies are validated against the catalog at CREATE FUNCTION time
-- in this Postgres version, so the column must already exist. They are
-- backfilled and locked to NOT NULL further down, after seed_system_roles
-- has populated organization_roles for every org.
alter table public.organization_members add column if not exists role_id uuid references public.organization_roles(id);
alter table public.invitations add column if not exists role_id uuid references public.organization_roles(id);

-- ---------------------------------------------------------------------------
-- has_permission: active, unexpired member whose role grants (resource, action).
-- ---------------------------------------------------------------------------
create or replace function public.has_permission(target_org uuid, p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and rp.resource = p_resource
      and rp.action = p_action
      and rp.granted
  );
$$;

revoke all on function public.has_permission(uuid, text, text) from public;
grant execute on function public.has_permission(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: any active member may read (nav needs it); only roles-editors write.
-- ---------------------------------------------------------------------------
create policy org_roles_select_member on public.organization_roles for select to authenticated
  using (exists (select 1 from public.organization_members m
                 where m.organization_id = organization_roles.organization_id
                   and m.user_id = (select auth.uid()) and m.status = 'active'));
create policy org_roles_write_editor on public.organization_roles for all to authenticated
  using (public.has_permission(organization_id, 'roles', 'edit'))
  with check (public.has_permission(organization_id, 'roles', 'edit'));
create policy role_perms_select_member on public.role_permissions for select to authenticated
  using (exists (select 1 from public.organization_roles r
                 join public.organization_members m on m.organization_id = r.organization_id
                 where r.id = role_permissions.role_id
                   and m.user_id = (select auth.uid()) and m.status = 'active'));
create policy role_perms_write_editor on public.role_permissions for all to authenticated
  using (exists (select 1 from public.organization_roles r where r.id = role_permissions.role_id
                   and public.has_permission(r.organization_id, 'roles', 'edit')))
  with check (exists (select 1 from public.organization_roles r where r.id = role_permissions.role_id
                   and public.has_permission(r.organization_id, 'roles', 'edit')));

-- ---------------------------------------------------------------------------
-- Guard triggers: system roles immutable shell; owner grants locked.
-- ---------------------------------------------------------------------------
create or replace function public.protect_system_roles() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Allow the cascade case: the parent org row is already gone (its own
    -- DELETE already committed within this transaction), so this row is
    -- being removed by `on delete cascade` from organizations, not by a
    -- direct attempt to delete a system role out from under a live org.
    if old.is_system and exists (select 1 from public.organizations where id = old.organization_id) then
      raise exception 'system roles cannot be deleted';
    end if;
    return old;
  end if;
  if old.is_system and (new.key <> old.key or new.name <> old.name or new.is_system <> old.is_system) then
    raise exception 'system roles cannot be renamed';
  end if;
  return new;
end $$;
drop trigger if exists organization_roles_protect on public.organization_roles;
create trigger organization_roles_protect before update or delete on public.organization_roles
  for each row execute function public.protect_system_roles();

create or replace function public.protect_owner_grants() returns trigger
language plpgsql as $$
declare v_key text;
begin
  select r.key into v_key from public.organization_roles r
    where r.id = coalesce(new.role_id, old.role_id);
  if v_key = 'owner' and current_setting('rbac.seeding', true) is distinct from 'on' then
    raise exception 'owner grants are locked';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists role_permissions_protect_owner on public.role_permissions;
create trigger role_permissions_protect_owner before insert or update or delete on public.role_permissions
  for each row execute function public.protect_owner_grants();

-- ---------------------------------------------------------------------------
-- Seeder: idempotent; mirrors DEFAULT_ROLE_GRANTS exactly.
-- ---------------------------------------------------------------------------
create or replace function public.seed_system_roles(target_org uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  crud text[] := array['view','add','edit','delete'];
  all_caps text[] := array[
    'organization.manage','organization.settings.update','membership.invite',
    'membership.role.change','membership.scope.change','membership.deactivate',
    'access_review.run','access_review.decide','break_glass.open',
    'break_glass.finalize','audit.read','audit_log.read','auth_security.read',
    'orders.reopen','data_console.manage'];
  all_resources text[] := array[
    'dashboard','products','orders','customers','market_prices','dispatch',
    'delivery_runs','delivery_setup','warehouse_tasks','loading','driver_deck',
    'leave','leave_management','users','roles','data_console','settings'];
  seller_crud text[] := array['products','orders','customers','market_prices','dispatch','delivery_runs'];
  r record; res text; act text; cap text;
begin
  perform set_config('rbac.seeding', 'on', true);

  insert into public.organization_roles (organization_id, key, name, rank, is_system) values
    (target_org, 'owner', 'Owner', 100, true),
    (target_org, 'org_admin', 'Admin', 80, true),
    (target_org, 'hr', 'HR', 75, true),
    (target_org, 'seller', 'Seller', 60, true),
    (target_org, 'supervisor', 'Supervisor', 60, true),
    (target_org, 'inventory', 'Worker', 40, true),
    (target_org, 'driver', 'Driver', 30, true)
  on conflict (organization_id, key) do nothing;

  for r in select id, key from public.organization_roles
           where organization_id = target_org and is_system loop
    if r.key = 'owner' then
      foreach res in array all_resources loop
        if res <> 'data_console' then
          foreach act in array crud loop
            insert into public.role_permissions values (r.id, res, act, true) on conflict do nothing;
          end loop;
        end if;
      end loop;
      foreach cap in array all_caps loop
        if cap <> 'data_console.manage' then
          insert into public.role_permissions values (r.id, cap, 'use', true) on conflict do nothing;
        end if;
      end loop;
    elsif r.key = 'org_admin' then
      foreach res in array all_resources loop
        foreach act in array crud loop
          insert into public.role_permissions values (r.id, res, act, true) on conflict do nothing;
        end loop;
      end loop;
      foreach cap in array all_caps loop
        insert into public.role_permissions values (r.id, cap, 'use', true) on conflict do nothing;
      end loop;
    elsif r.key = 'hr' then
      foreach res in array array['leave','leave_management'] loop
        foreach act in array crud loop
          insert into public.role_permissions values (r.id, res, act, true) on conflict do nothing;
        end loop;
      end loop;
    elsif r.key in ('seller','supervisor') then
      foreach res in array seller_crud loop
        foreach act in array crud loop
          insert into public.role_permissions values (r.id, res, act, true) on conflict do nothing;
        end loop;
      end loop;
      insert into public.role_permissions values (r.id, 'delivery_setup', 'view', true) on conflict do nothing;
      insert into public.role_permissions values (r.id, 'loading', 'edit', true) on conflict do nothing;
      insert into public.role_permissions values (r.id, 'leave', 'view', true) on conflict do nothing;
      insert into public.role_permissions values (r.id, 'leave', 'add', true) on conflict do nothing;
    elsif r.key = 'inventory' then
      insert into public.role_permissions values
        (r.id,'warehouse_tasks','view',true),(r.id,'warehouse_tasks','edit',true),
        (r.id,'loading','view',true),(r.id,'loading','edit',true),
        (r.id,'leave','view',true),(r.id,'leave','add',true)
      on conflict do nothing;
    elsif r.key = 'driver' then
      insert into public.role_permissions values
        (r.id,'driver_deck','view',true),(r.id,'driver_deck','edit',true),
        (r.id,'leave','view',true),(r.id,'leave','add',true)
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- No `grant execute ... to authenticated` here, deliberately: this is a
-- privileged reset-to-defaults operation (it re-inserts every default grant
-- for an org, including ones an owner may have since revoked). It must only
-- be reachable from trusted, definer-run contexts — this migration's own
-- backfill DO block below and the `organizations_seed_roles` trigger — never
-- directly over PostgREST by an ordinary authenticated user.
revoke all on function public.seed_system_roles(uuid) from public, authenticated, anon;

-- Seed every existing org, then wire members/invitations to role_id.
do $$ declare o record; begin
  for o in select id from public.organizations loop
    perform public.seed_system_roles(o.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- New-org hook: this app is currently single-tenant (the only organization
-- row is created by the 20260624000004_id_access_seed.sql pilot seed), so
-- there is no application code path that inserts into `organizations` today.
-- A trigger is the robust place to wire the seeder in regardless: it covers
-- the existing seed migration's insert, any future admin/onboarding flow,
-- and tests, without requiring every future call site to remember to seed.
-- ---------------------------------------------------------------------------
create or replace function public.seed_system_roles_on_org_insert() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_system_roles(new.id);
  return new;
end $$;
drop trigger if exists organizations_seed_roles on public.organizations;
create trigger organizations_seed_roles after insert on public.organizations
  for each row execute function public.seed_system_roles_on_org_insert();

update public.organization_members m set role_id = r.id
  from public.organization_roles r
  where r.organization_id = m.organization_id and r.key = m.role
    and m.role_id is null;
alter table public.organization_members alter column role_id set not null;

update public.invitations i set role_id = r.id
  from public.organization_roles r
  where r.organization_id = i.organization_id and r.key = i.role
    and i.role_id is null;

-- ---------------------------------------------------------------------------
-- Transitional sync: writers may still set only `role` (text) or only role_id.
-- ---------------------------------------------------------------------------
create or replace function public.sync_member_role_columns() returns trigger
language plpgsql as $$
declare v uuid; v_key text;
begin
  -- OLD is unassigned on INSERT triggers, so every OLD.* read below must be
  -- guarded by tg_op = 'INSERT' first (short-circuit) rather than compared
  -- against unconditionally.
  if new.role_id is not null and (tg_op = 'INSERT' or new.role_id is distinct from old.role_id) then
    select key into v_key from public.organization_roles where id = new.role_id;
    new.role := coalesce(v_key, new.role);
  elsif tg_op = 'INSERT' or new.role is distinct from old.role then
    select id into v from public.organization_roles
      where organization_id = new.organization_id and key = new.role;
    if v is not null then new.role_id := v; end if;
  end if;
  return new;
end $$;
drop trigger if exists organization_members_sync_role on public.organization_members;
create trigger organization_members_sync_role before insert or update on public.organization_members
  for each row execute function public.sync_member_role_columns();
drop trigger if exists invitations_sync_role on public.invitations;
create trigger invitations_sync_role before insert or update on public.invitations
  for each row execute function public.sync_member_role_columns();

-- ---------------------------------------------------------------------------
-- Fold existing per-org overrides into the seeded grants, then retire later
-- (table dropped in the cleanup migration, Task 13).
-- ---------------------------------------------------------------------------
update public.role_permissions rp set granted = o.granted
  from public.role_capability_overrides o
  join public.organization_roles r on r.organization_id = o.organization_id and r.key = o.role
  where rp.role_id = r.id and rp.resource = o.capability and rp.action = 'use';
insert into public.role_permissions (role_id, resource, action, granted)
  select r.id, o.capability, 'use', o.granted
  from public.role_capability_overrides o
  join public.organization_roles r on r.organization_id = o.organization_id and r.key = o.role
  on conflict do nothing;

commit;
