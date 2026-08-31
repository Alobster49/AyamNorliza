-- Bound the authority of `roles.edit`.
--
-- `role_permissions` and `organization_roles` are granted directly to
-- `authenticated`; their writes are gated purely by RLS. Until now that gate
-- asked one question — does the caller hold `roles:edit`? — and nothing else.
-- So `roles:edit` was not "may manage roles", it was "may grant anything to
-- anyone": a custom role seeded at rank 1 with only the roles editor could
-- hand itself `data_console.manage`, `users:delete` or `break_glass.open`
-- and reach full admin without ever passing through the rank-gated
-- `org_members_update_admin` policy that 20260901000004 hardened. Only the
-- literal `owner` role was protected, by the `protect_owner_grants` trigger.
--
-- Two rules close it, both mirroring how the rest of the RBAC schema already
-- thinks about delegation:
--
--   1. Self-authority. A grant may only hand out a (resource, action) the
--      caller already holds. Revokes are unrestricted — de-escalation is
--      never an escalation. This subsumes the app layer's one-off fence on
--      `data_console.manage`: owner does not hold that capability, so owner
--      can no longer grant it, which is exactly what that fence intended.
--
--   2. Rank ceiling. A role editor may only reach roles ranked at or below
--      its own, matching `org_members_update_admin`'s treatment of
--      memberships. This covers the role row itself, so a low-ranked editor
--      can no longer rename or delete a role above it.
--
-- Neither rule changes anything for the seeded roles: org_admin holds every
-- capability and outranks everything below owner, and owner outranks all.
--
-- The one flow the self-authority rule would otherwise break is "reset this
-- system role to its defaults" — admin's defaults include
-- `data_console.manage`, which an owner cannot grant. Reset is not an
-- arbitrary grant though, it restores the documented baseline, so it moves
-- from a client-issued delete+insert pair (also non-atomic: a failure
-- between the two left the role with no permissions at all) to the
-- definer-run `reset_role_to_defaults` below.

begin;

-- ---------------------------------------------------------------------------
-- 1. role_permissions: rank ceiling + self-authority on grants.
-- ---------------------------------------------------------------------------
drop policy if exists role_perms_write_editor on public.role_permissions;
create policy role_perms_write_editor on public.role_permissions for all to authenticated
  using (
    exists (
      select 1
        from public.organization_roles r
       where r.id = role_permissions.role_id
         and public.has_permission(r.organization_id, 'roles', 'edit')
         and r.rank <= public.caller_role_rank(r.organization_id)
    )
  )
  with check (
    exists (
      select 1
        from public.organization_roles r
       where r.id = role_permissions.role_id
         and public.has_permission(r.organization_id, 'roles', 'edit')
         and r.rank <= public.caller_role_rank(r.organization_id)
         -- Only the granting direction is bounded by the caller's own
         -- authority; `granted = false` (and a NULL, which the column
         -- rejects anyway) always passes.
         and (
           role_permissions.granted is not true
           or public.has_permission(
                r.organization_id,
                role_permissions.resource,
                role_permissions.action)
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. organization_roles: same rank ceiling on the role row.
--
-- `createRoleAction` ranks a new role at min(actor rank - 1, 10), so it
-- still satisfies the WITH CHECK; what this stops is reaching *upward* to
-- rename, re-rank or delete a role that outranks the caller.
-- ---------------------------------------------------------------------------
drop policy if exists org_roles_write_editor on public.organization_roles;
create policy org_roles_write_editor on public.organization_roles for all to authenticated
  using (
    public.has_permission(organization_id, 'roles', 'edit')
    and rank <= public.caller_role_rank(organization_id)
  )
  with check (
    public.has_permission(organization_id, 'roles', 'edit')
    and rank <= public.caller_role_rank(organization_id)
  );

-- ---------------------------------------------------------------------------
-- 3. reset_role_to_defaults: restore one system role's shipped baseline.
--
-- Definer-run so it can write the defaults verbatim rather than being
-- filtered by the self-authority rule above — the caller is not inventing a
-- grant here, they are restoring what the role shipped with. Delegates to
-- `seed_system_roles`, whose inserts are all `on conflict do nothing`, so
-- clearing this one role's rows first means only this role is rebuilt and
-- every other role's customizations survive untouched.
-- ---------------------------------------------------------------------------
create or replace function public.reset_role_to_defaults(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_key text;
  v_rank integer;
  v_is_system boolean;
begin
  select r.organization_id, r.key, r.rank, r.is_system
    into v_org, v_key, v_rank, v_is_system
    from public.organization_roles r
   where r.id = p_role_id;

  if v_org is null then
    raise exception 'role not found' using errcode = 'P0002';
  end if;

  if not public.has_permission(v_org, 'roles', 'edit') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_rank > public.caller_role_rank(v_org) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_key = 'owner' then
    raise exception 'owner grants are locked' using errcode = 'P0001';
  end if;

  if not v_is_system then
    raise exception 'custom roles have no defaults' using errcode = 'P0001';
  end if;

  -- `protect_owner_grants` fires on this delete; the owner case is already
  -- refused above, so the flag is only about letting the reseed write rows
  -- the caller could not have written by hand.
  perform set_config('rbac.seeding', 'on', true);
  delete from public.role_permissions where role_id = p_role_id;
  perform public.seed_system_roles(v_org);
  -- `seed_system_roles` leaves the flag on. It is transaction-local, so it
  -- would clear itself at commit either way, but a PostgREST request can
  -- carry several statements — put it back rather than leaving the owner
  -- trigger disarmed for the rest of the transaction.
  perform set_config('rbac.seeding', 'off', true);
end $$;

revoke all on function public.reset_role_to_defaults(uuid) from public, anon;
grant execute on function public.reset_role_to_defaults(uuid) to authenticated;

comment on function public.reset_role_to_defaults(uuid) is
  'Restores one system role to its seeded default grants. Requires roles:edit and a rank at or above the target role. Refuses the owner role and custom roles.';

commit;
