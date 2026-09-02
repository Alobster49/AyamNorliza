-- Driver roster: which driver usually drives which truck, and who covers a
-- truck on a given day. Spec: docs/superpowers/specs/2026-09-02-driver-roster-design.md
--
-- A driver is otherwise attached to a RUN (delivery_runs.driver_id), and
-- runs only exist once orders are assigned. This adds the two facts the
-- roster needs before that: a truck's regular driver, and per-day covers.

-- ---------------------------------------------------------------------------
-- 1. trucks.regular_driver_id
--
-- NOTE: writes to regular_driver_id are gated by the existing `trucks_update`
-- policy, which checks delivery_runs:edit -- NOT driver_roster:edit. A custom
-- role holding only the roster grant therefore updates zero rows without an
-- error; setRegularDriver() selects the ids back and reports that as denied.
-- ---------------------------------------------------------------------------
alter table public.trucks
  add column if not exists regular_driver_id uuid null references auth.users(id) on delete set null;

create index if not exists trucks_regular_driver_idx on public.trucks (regular_driver_id);

-- ---------------------------------------------------------------------------
-- 2. truck_covers
-- ---------------------------------------------------------------------------
create table if not exists public.truck_covers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  cover_date date not null,
  -- A cover is meaningless once the covering driver's account is gone.
  driver_id uuid not null references auth.users(id) on delete cascade,
  note text null check (note is null or char_length(note) <= 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (truck_id, cover_date)
);

create index if not exists truck_covers_org_date_idx on public.truck_covers (organization_id, cover_date);
create index if not exists truck_covers_driver_date_idx on public.truck_covers (driver_id, cover_date);

alter table public.truck_covers enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Validation helpers + triggers (security definer: the seller who writes a
--    cover cannot read leave_requests, but the rule still has to hold).
-- ---------------------------------------------------------------------------
create or replace function public.roster_assert_driver_member(p_org uuid, p_driver uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_driver is null then
    return;
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = p_driver
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and m.role = 'driver'
  ) then
    raise exception using errcode = 'P0001', message = 'driver_not_member';
  end if;
end;
$$;

-- Only the trigger functions below need it, and they are security definer
-- owned by the same role, so they keep executing it after this revoke.
revoke all on function public.roster_assert_driver_member(uuid, uuid) from public;

create or replace function public.trucks_validate_regular_driver()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.regular_driver_id is distinct from old.regular_driver_id then
    perform public.roster_assert_driver_member(new.organization_id, new.regular_driver_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trucks_validate_regular_driver on public.trucks;
create trigger trucks_validate_regular_driver
  before insert or update on public.trucks
  for each row execute function public.trucks_validate_regular_driver();

create or replace function public.truck_covers_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_truck_org uuid;
begin
  select organization_id into v_truck_org from public.trucks where id = new.truck_id;
  if v_truck_org is null or v_truck_org <> new.organization_id then
    raise exception using errcode = 'P0001', message = 'truck_org_mismatch';
  end if;

  perform public.roster_assert_driver_member(new.organization_id, new.driver_id);

  if exists (
    select 1 from public.leave_requests r
    where r.organization_id = new.organization_id
      and r.user_id = new.driver_id
      and r.status = 'approved'
      and new.cover_date between r.start_date and r.end_date
  ) then
    raise exception using errcode = 'P0001', message = 'driver_on_leave';
  end if;

  if exists (
    select 1 from public.truck_covers c
    where c.organization_id = new.organization_id
      and c.driver_id = new.driver_id
      and c.cover_date = new.cover_date
      and c.truck_id <> new.truck_id
      and c.id <> new.id
  ) then
    raise exception using errcode = 'P0001', message = 'driver_double_booked';
  end if;

  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists truck_covers_before_write on public.truck_covers;
create trigger truck_covers_before_write
  before insert or update on public.truck_covers
  for each row execute function public.truck_covers_before_write();

-- ---------------------------------------------------------------------------
-- 4. RLS. Read: any member holding driver_roster:view (drivers hold none).
--    Write: driver_roster:edit.
-- ---------------------------------------------------------------------------
drop policy if exists truck_covers_select on public.truck_covers;
create policy truck_covers_select on public.truck_covers
  for select to authenticated
  using (public.has_permission(organization_id, 'driver_roster', 'view'));

drop policy if exists truck_covers_insert on public.truck_covers;
create policy truck_covers_insert on public.truck_covers
  for insert to authenticated
  with check (public.has_permission(organization_id, 'driver_roster', 'edit'));

drop policy if exists truck_covers_update on public.truck_covers;
create policy truck_covers_update on public.truck_covers
  for update to authenticated
  using (public.has_permission(organization_id, 'driver_roster', 'edit'))
  with check (public.has_permission(organization_id, 'driver_roster', 'edit'));

drop policy if exists truck_covers_delete on public.truck_covers;
create policy truck_covers_delete on public.truck_covers
  for delete to authenticated
  using (public.has_permission(organization_id, 'driver_roster', 'edit'));

grant select, insert, update, delete on public.truck_covers to authenticated;

-- delivery_runs select is gated by has_ops_read, which HR does not hold, so
-- the roster would silently read zero runs for them and show the regular
-- driver where a run already names someone else. This second permissive
-- policy admits exactly the roles that can see the roster; drivers hold no
-- driver_roster grant, so their own narrowed policy still bounds them.
drop policy if exists delivery_runs_select_roster on public.delivery_runs;
create policy delivery_runs_select_roster on public.delivery_runs
  for select to authenticated
  using (public.has_permission(organization_id, 'driver_roster', 'view'));

-- ---------------------------------------------------------------------------
-- 5. leave_roster: safe columns + status, for roster viewers only.
--    (leave_whos_away stays approved-only for colleagues.)
-- ---------------------------------------------------------------------------
create or replace view public.leave_roster
with (security_invoker = false) as
select r.organization_id, r.user_id, r.leave_type_id, r.start_date, r.end_date, r.status
from public.leave_requests r
where r.status in ('approved', 'pending')
  and public.has_permission(r.organization_id, 'driver_roster', 'view')
  -- Drivers' leave only. The roster has no use for anyone else's absence,
  -- and this view is readable by every roster viewer (seller, supervisor),
  -- who otherwise cannot see leave_requests at all.
  and exists (
    select 1 from public.organization_members m
    where m.organization_id = r.organization_id
      and m.user_id = r.user_id
      and m.status = 'active'
      and m.role = 'driver'
  );

grant select on public.leave_roster to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Permissions: new resource driver_roster. Seed for existing orgs and
--    teach the seeder about it for future orgs.
-- ---------------------------------------------------------------------------
do $$
declare r record; act text;
begin
  perform set_config('rbac.seeding', 'on', true);
  for r in select id, key from public.organization_roles where is_system loop
    if r.key in ('owner', 'org_admin', 'seller', 'supervisor') then
      foreach act in array array['view','add','edit','delete'] loop
        insert into public.role_permissions values (r.id, 'driver_roster', act, true) on conflict do nothing;
      end loop;
    elsif r.key = 'hr' then
      insert into public.role_permissions values (r.id, 'driver_roster', 'view', true) on conflict do nothing;
    end if;
  end loop;
end $$;

-- The seeder is redefined in full so a fresh org gets the same grants.
-- Copied byte-for-byte from public.seed_system_roles in
-- 20260901000001_dynamic_rbac_schema.sql (verified against the live
-- pg_get_functiondef, since it is the only migration that has ever defined
-- this function) with exactly three edits:
--   (a) append 'driver_roster' to all_resources;
--   (b) append 'driver_roster' to seller_crud;
--   (c) in the hr branch, after the leave/leave_management loop, add a
--       driver_roster:view grant.
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
    'leave','leave_management','users','roles','data_console','settings','driver_roster'];
  seller_crud text[] := array['products','orders','customers','market_prices','dispatch','delivery_runs','driver_roster'];
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
      insert into public.role_permissions values (r.id, 'driver_roster', 'view', true) on conflict do nothing;
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

revoke all on function public.seed_system_roles(uuid) from public, authenticated, anon;
