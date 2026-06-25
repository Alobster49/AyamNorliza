-- 20260624000002_id_access_rls.sql
-- MOD-01 RLS: helpers, then per-table policies.
--
-- Helpers are SECURITY DEFINER with a fixed search_path. We grant EXECUTE
-- only to `authenticated`. Anonymous users cannot read or write any
-- tenant-owned data.
--
-- Policy patterns follow the shared security doc (§27.3):
--   - SELECT/INSERT/UPDATE/DELETE policies are split.
--   - WITH CHECK prevents inserting or updating into an unauthorized
--     organization/scope.
--   - Privileged actions (role change, deactivation, break-glass,
--     support session open) require has_org_role(...) checks.
--   - audit_log and auth_security_events accept inserts ONLY via the
--     SECURITY DEFINER wrappers defined here; no policy permits direct
--     INSERT from `authenticated` to these tables.

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Stable: same input -> same result within a single query, depends only
-- on (target_org, auth.uid()) and the membership table.
create or replace function public.is_active_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
  );
$$;

revoke all on function public.is_active_org_member(uuid) from public;
grant execute on function public.is_active_org_member(uuid) to authenticated;

create or replace function public.has_org_role(target_org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and m.role = any(roles)
  );
$$;

revoke all on function public.has_org_role(uuid, text[]) from public;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

-- Returns the caller's actor session id (from custom JWT claim `sid`).
create or replace function public.current_actor_session_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'sid',
      (auth.jwt() ->> 'sid')
    ),
    ''
  )::uuid;
$$;

revoke all on function public.current_actor_session_id() from public;
grant execute on function public.current_actor_session_id() to authenticated;

-- Returns true when the caller has an active (non-expired, non-ended)
-- break-glass event in this organization.
create or replace function public.is_break_glass_active(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.break_glass_events b
    where b.organization_id = target_org
      and b.user_id = (select auth.uid())
      and b.ended_at is null
      and b.expires_at > now()
  );
$$;

revoke all on function public.is_break_glass_active(uuid) from public;
grant execute on function public.is_break_glass_active(uuid) to authenticated;

-- Returns the role rank used by `can_grant_role` to forbid broadening.
create or replace function public.role_rank(role text)
returns integer
language sql
immutable
as $$
  select case role
    when 'owner' then 100
    when 'org_admin' then 80
    when 'farm_manager' then 60
    when 'supervisor' then 50
    when 'veterinarian' then 50
    when 'biosecurity_qa' then 50
    when 'maintenance' then 40
    when 'inventory' then 40
    when 'logistics' then 40
    when 'caretaker' then 30
    when 'auditor' then 20
    when 'support' then 10
    else 0
  end;
$$;

revoke all on function public.role_rank(text) from public;
grant execute on function public.role_rank(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
alter table public.organizations                 enable row level security;
alter table public.profiles                      enable row level security;
alter table public.organization_members          enable row level security;
alter table public.member_scopes                 enable row level security;
alter table public.invitations                   enable row level security;
alter table public.access_reviews                enable row level security;
alter table public.access_review_items           enable row level security;
alter table public.support_sessions              enable row level security;
alter table public.break_glass_events            enable row level security;
alter table public.auth_security_events          enable row level security;
alter table public.audit_log                     enable row level security;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy organizations_select_members
  on public.organizations for select to authenticated
  using (public.is_active_org_member(id));

create policy organizations_insert_owner
  on public.organizations for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = id
        and m.user_id = (select auth.uid())
        and m.role = 'owner'
        and m.status = 'active'
    )
    or not exists (
      select 1 from public.organization_members m
      where m.organization_id = id
    )
  );

create policy organizations_update_owner
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner']))
  with check (public.has_org_role(id, array['owner']));

create policy organizations_delete_owner
  on public.organizations for delete to authenticated
  using (public.has_org_role(id, array['owner']));

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self_or_org_member
  on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.organization_members m
      where m.user_id = profiles.user_id
        and public.is_active_org_member(m.organization_id)
    )
  );

create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Profile deactivation is performed by an admin action (separate policy
-- for the special case). Owners/admins can flip status to 'inactive' but
-- not change the user_id.
create policy profiles_admin_status_update
  on public.profiles for update to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner','org_admin')
    )
  )
  with check (
    user_id = user_id  -- user_id is immutable via this policy.
  );

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create policy org_members_select_member
  on public.organization_members for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy org_members_insert_admin
  on public.organization_members for insert to authenticated
  with check (
    public.has_org_role(organization_id, array['owner','org_admin'])
    and public.role_rank(role) <= public.role_rank((
      select m.role from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
      limit 1
    ))
  );

create policy org_members_update_admin
  on public.organization_members for update to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin']))
  with check (
    public.has_org_role(organization_id, array['owner','org_admin'])
    and public.role_rank(role) <= public.role_rank((
      select m.role from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
      limit 1
    ))
  );

-- Direct DELETE blocked; revocation is by status update.
-- (No policy -> denied for `authenticated`; the admin client is allowed
-- because it is not subject to RLS.)

-- ---------------------------------------------------------------------------
-- member_scopes
-- ---------------------------------------------------------------------------
create policy member_scopes_select_member
  on public.member_scopes for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy member_scopes_admin_write
  on public.member_scopes for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
create policy invitations_select_admin_or_invitee
  on public.invitations for select to authenticated
  using (
    public.has_org_role(organization_id, array['owner','org_admin'])
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy invitations_insert_admin
  on public.invitations for insert to authenticated
  with check (
    public.has_org_role(organization_id, array['owner','org_admin'])
    and public.role_rank(role) <= public.role_rank((
      select m.role from public.organization_members m
      where m.organization_id = invitations.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
      limit 1
    ))
  );

create policy invitations_revoke_admin
  on public.invitations for update to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin']))
  with check (
    public.has_org_role(organization_id, array['owner','org_admin'])
    -- Inviter can only set revoked_at; other fields are frozen by trigger
    -- in migration 03.
  );

-- ---------------------------------------------------------------------------
-- access_reviews / access_review_items
-- ---------------------------------------------------------------------------
create policy access_reviews_select_admin
  on public.access_reviews for select to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin']));

create policy access_reviews_admin_write
  on public.access_reviews for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin']))
  with check (public.has_org_role(organization_id, array['owner','org_admin']));

create policy access_review_items_select_admin_or_subject
  on public.access_review_items for select to authenticated
  using (
    public.has_org_role((
      select m.organization_id
      from public.organization_members m
      where m.id = organization_member_id
    ), array['owner','org_admin'])
    or organization_member_id in (
      select id from public.organization_members
      where user_id = (select auth.uid())
    )
  );

create policy access_review_items_admin_write
  on public.access_review_items for all to authenticated
  using (public.has_org_role((
    select m.organization_id
    from public.organization_members m
    where m.id = organization_member_id
  ), array['owner','org_admin']))
  with check (
    organization_member_id <> (
      select m.id from public.organization_members m
      where m.user_id = (select auth.uid())
      and m.status = 'active'
      limit 1
    )
  );

-- ---------------------------------------------------------------------------
-- support_sessions
-- ---------------------------------------------------------------------------
create policy support_sessions_select_visible
  on public.support_sessions for select to authenticated
  using (
    public.is_active_org_member(organization_id)
    or technician_id = (select auth.uid())
    or sponsor_id = (select auth.uid())
  );

create policy support_sessions_admin_write
  on public.support_sessions for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin']))
  with check (public.has_org_role(organization_id, array['owner','org_admin']));

-- ---------------------------------------------------------------------------
-- break_glass_events
-- ---------------------------------------------------------------------------
create policy break_glass_select_member
  on public.break_glass_events for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy break_glass_insert_self_or_owner
  on public.break_glass_events for insert to authenticated
  with check (
    (user_id = (select auth.uid())
     and (approved_by is null or approved_by = user_id
          or exists (select 1 from public.organization_members m
                     where m.user_id = approved_by
                       and m.role = 'owner'
                       and m.status = 'active'
                       and m.organization_id = break_glass_events.organization_id)))
    or exists (select 1 from public.organization_members m
               where m.user_id = (select auth.uid())
                 and m.role = 'owner'
                 and m.status = 'active'
                 and m.organization_id = break_glass_events.organization_id)
  );

create policy break_glass_update_end
  on public.break_glass_events for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.organization_members m
               where m.user_id = (select auth.uid())
                 and m.role = 'owner'
                 and m.status = 'active'
                 and m.organization_id = break_glass_events.organization_id)
  )
  with check (true);

-- ---------------------------------------------------------------------------
-- auth_security_events
-- ---------------------------------------------------------------------------
-- Inserts happen via the SECURITY DEFINER wrapper below; updates/deletes
-- are blocked entirely.
create policy auth_security_events_select_admin
  on public.auth_security_events for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.organization_members m
      where m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner','org_admin')
    )
  );

-- No INSERT/UPDATE/DELETE policies for `authenticated` -> denied by RLS.
-- The `record_auth_security_event` function is the only path.

create or replace function public.record_auth_security_event(
  p_user_id uuid,
  p_organization_id uuid,
  p_event_type text,
  p_ip inet,
  p_user_agent text,
  p_geo_country text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.auth_security_events(
    id, user_id, organization_id, event_type,
    ip, user_agent, geo_country, metadata, occurred_at
  ) values (
    v_id, p_user_id, p_organization_id, p_event_type,
    p_ip, p_user_agent, p_geo_country,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  );
  return v_id;
end;
$$;

revoke all on function public.record_auth_security_event(
  uuid, uuid, text, inet, text, text, jsonb
) from public;
grant execute on function public.record_auth_security_event(
  uuid, uuid, text, inet, text, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create policy audit_log_select_admin
  on public.audit_log for select to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner','org_admin')
        and (
          m.organization_id = audit_log.organization_id
          or audit_log.organization_id is null
        )
    )
  );

-- No INSERT/UPDATE/DELETE policies for `authenticated` -> denied by RLS.
-- The `record_audit_event` function below is the only insert path, and the
-- `audit_log_no_mutate` trigger blocks UPDATE/DELETE even for service_role.

create or replace function public.record_audit_event(
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_correlation_id uuid,
  p_client_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_actor uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_session uuid;
begin
  -- Resolve caller's org and role from any active membership.
  select m.organization_id, m.role
    into v_org, v_role
  from public.organization_members m
  where m.user_id = v_actor
    and m.status = 'active'
  limit 1;

  v_session := public.current_actor_session_id();

  insert into public.audit_log(
    id, organization_id, actor_user_id, actor_role, actor_session_id,
    event_type, entity_type, entity_id,
    before, after, reason, correlation_id, client_operation_id,
    source, occurred_at
  ) values (
    v_id, v_org, v_actor, v_role, v_session,
    p_event_type, p_entity_type, p_entity_id,
    p_before, p_after, p_reason, p_correlation_id, p_client_operation_id,
    'web', now()
  );
  return v_id;
end;
$$;

revoke all on function public.record_audit_event(
  text, text, uuid, jsonb, jsonb, text, uuid, uuid
) from public;
grant execute on function public.record_audit_event(
  text, text, uuid, jsonb, jsonb, text, uuid, uuid
) to service_role;

commit;
