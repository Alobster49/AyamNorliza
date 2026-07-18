-- 20260712000002_role_capability_overrides_rls.sql
-- RLS policies for role_capability_overrides, and the
-- `effective_capabilities` helper used by both the UI (to render the
-- matrix) and any future runtime callers (currently callers stay on the
-- hardcoded matrix on the hot path; the DB is consulted only when the UI
-- asks "what does this role look like right now?").
--
-- Policy model:
--   * SELECT: any owner of the organization can read overrides so the UI
--     can render the resolved matrix; non-owners cannot read individual
--     override rows (they see the canonical matrix only).
--   * INSERT/UPDATE/DELETE: only owners. All writes require reauth, which
--     is enforced in the Server Action (not at the DB layer because RLS
--     has no step-up hook).
--   * Direct DELETE blocked; "reset to default" is a hard DELETE that we
--     allow only for owners because the action is atomic and reversible.

begin;

alter table public.role_capability_overrides enable row level security;

grant select, insert, update, delete on public.role_capability_overrides
  to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy role_caps_select_owner
  on public.role_capability_overrides for select to authenticated
  using (public.has_org_role(organization_id, array['owner']));

create policy role_caps_insert_owner
  on public.role_capability_overrides for insert to authenticated
  with check (
    public.has_org_role(organization_id, array['owner'])
    -- Defense in depth: the CHECK on role <> 'owner' is the source of truth,
    -- but re-state it here so a policy audit reads naturally.
    and role <> 'owner'
  );

create policy role_caps_update_owner
  on public.role_capability_overrides for update to authenticated
  using (public.has_org_role(organization_id, array['owner']))
  with check (
    public.has_org_role(organization_id, array['owner'])
    and role <> 'owner'
  );

create policy role_caps_delete_owner
  on public.role_capability_overrides for delete to authenticated
  using (public.has_org_role(organization_id, array['owner']));

-- ---------------------------------------------------------------------------
-- effective_capabilities: returns a JSON object keyed by role whose value
-- is a JSON object keyed by capability mapping to boolean. Used by the UI
-- to render the resolved matrix in one round-trip.
--
-- Note: this function is SECURITY INVOKER (default) and only SELECTs from
-- role_capability_overrides, which is already RLS-locked to owners of the
-- organization. Non-owners cannot read the table, so the function returns
-- only the canonical matrix for them.
-- ---------------------------------------------------------------------------
create or replace function public.effective_capabilities(p_org uuid)
returns jsonb
language sql
stable
as $$
  with overrides as (
    select role, capability, granted
    from public.role_capability_overrides
    where organization_id = p_org
  ),
  base_matrix as (
    -- Mirror the hardcoded matrix in src/lib/auth/permissions.ts.
    -- If that file is updated, this view must be updated too; the
    -- reverse-sync is owned by MOD-19.
    select * from (values
      ('owner', 'organization.manage', true),
      ('owner', 'organization.settings.update', true),
      ('owner', 'membership.invite', true),
      ('owner', 'membership.role.change', true),
      ('owner', 'membership.scope.change', true),
      ('owner', 'membership.deactivate', true),
      ('owner', 'access_review.run', true),
      ('owner', 'access_review.decide', true),
      ('owner', 'support_session.open', true),
      ('owner', 'support_session.end', true),
      ('owner', 'break_glass.open', true),
      ('owner', 'break_glass.finalize', true),
      ('owner', 'audit.read', true),
      ('owner', 'audit_log.read', true),
      ('owner', 'auth_security.read', true),
      ('owner', 'step_up.reauth', true),

      ('org_admin', 'organization.manage', true),
      ('org_admin', 'organization.settings.update', true),
      ('org_admin', 'membership.invite', true),
      ('org_admin', 'membership.role.change', true),
      ('org_admin', 'membership.scope.change', true),
      ('org_admin', 'membership.deactivate', true),
      ('org_admin', 'access_review.run', true),
      ('org_admin', 'access_review.decide', true),
      ('org_admin', 'support_session.open', true),
      ('org_admin', 'support_session.end', true),
      ('org_admin', 'audit.read', true),
      ('org_admin', 'audit_log.read', true),
      ('org_admin', 'auth_security.read', true),
      ('org_admin', 'step_up.reauth', true),

      ('farm_manager', 'membership.invite', true),
      ('farm_manager', 'membership.scope.change', true),
      ('farm_manager', 'access_review.run', true),
      ('farm_manager', 'audit.read', true),
      ('farm_manager', 'step_up.reauth', true),

      ('supervisor', 'audit.read', true),
      ('supervisor', 'step_up.reauth', true),

      ('caretaker', 'step_up.reauth', false),

      ('veterinarian', 'step_up.reauth', true),

      ('biosecurity_qa', 'audit.read', true),
      ('biosecurity_qa', 'step_up.reauth', true),

      ('maintenance', 'step_up.reauth', true),
      ('inventory', 'step_up.reauth', true),
      ('logistics', 'step_up.reauth', true),

      ('auditor', 'audit.read', true),
      ('auditor', 'audit_log.read', true),

      ('support', 'step_up.reauth', false)
    ) as b(role, capability, granted)
  ),
  -- Apply overrides only for rows that exist; null means "no override".
  merged as (
    select
      b.role,
      b.capability,
      coalesce(o.granted, b.granted) as granted
    from base_matrix b
    left join overrides o
      on o.role = b.role and o.capability = b.capability
  )
  select jsonb_object_agg(
    role,
    jsonb_object_agg(capability, granted)
      filter (where role is not null)
  ) from merged
  group by role;
$$;

-- We need a single aggregate even when the matrix is empty; coalesce to {}.
create or replace function public.effective_capabilities(p_org uuid, p_role text)
returns jsonb
language sql
stable
as $$
  select coalesce(
    (public.effective_capabilities(p_org) -> p_role),
    '{}'::jsonb
  );
$$;

revoke all on function public.effective_capabilities(uuid) from public;
grant execute on function public.effective_capabilities(uuid) to authenticated;

revoke all on function public.effective_capabilities(uuid, text) from public;
grant execute on function public.effective_capabilities(uuid, text) to authenticated;

commit;
