-- 20260901000003_dynamic_rbac_role_hardening.sql
--
-- Reviewer-flagged hardening on top of the dynamic-RBAC schema
-- (20260901000001) before custom roles go live:
--
-- 1. (Important #4) `organization_members_role_check` and
--    `invitations_role_check` (added by 20260831000001_role_realignment.sql)
--    hardcode the seven-role enum on the legacy `role` text column, which
--    blocks inserting/updating a row with ANY custom role's key -- a
--    contradiction with `organization_roles` now allowing org-defined roles.
--    Dropped outright: consistency is owned by the `role_id` foreign key
--    (references organization_roles(id), not-null) plus the
--    `sync_member_role_columns` trigger (20260901000001) that keeps `role`
--    text in lockstep with `role_id`'s key -- the text column can no longer
--    drift to an unknown value through the app or the trigger, so the CHECK
--    was only ever blocking legitimate custom-role rows, not preventing
--    anything the trigger doesn't already guarantee.
--    (`role_capability_overrides_role_check` is untouched -- that table is
--    superseded by role_permissions and dropped in Task 13; not a live gate.)
--
-- 2. (Critical #1) `organization_roles.rank` feeds `canGrantRole()` on the
--    app side (src/lib/auth/permissions.ts): an actor may grant/manage any
--    role whose rank is <= their own. Before this migration, nothing in the
--    DB stopped an owner of `roles.edit` (an org_admin, per the seed) from
--    editing a role's `rank` directly -- e.g. bumping a custom role's rank to
--    200, or a system role's rank up past `owner`'s 100 -- which mints
--    privilege the editor could then grant to themselves or an ally via the
--    ordinary role-grant path. `protect_system_roles()` is extended so:
--      (a) a system role's `rank` is immutable on UPDATE (alongside the
--          existing key/name/is_system lock) -- the seeded ranks
--          (owner=100 .. driver=30) are the one fixed ladder every custom
--          role's rank is measured against;
--      (b) a non-system role's `rank` must be in [1, 10] on INSERT or
--          UPDATE -- matches the plan's custom-role rank rule (created rank
--          = min(actorRank-1, 10), floor 1), so a custom role can never
--          reach or exceed the lowest system role's rank (`driver` = 30),
--          let alone `owner`. The trigger is widened from
--          `before update or delete` to `before insert or update or delete`
--          so (b) also covers the INSERT path (previously unfired).
--
--    Also closes a bypass those two checks would otherwise have: flipping
--    `is_system` itself (either direction) in the same UPDATE statement is
--    now rejected outright, so a caller can't dodge the immutable-rank
--    check (gated on the OLD row being a system role) or the [1,10] cap
--    (gated on the NEW row not being one) by changing is_system mid-write.
--
-- Both fixes are pure DB-side hardening: the app already computes the
-- intended custom-role rank correctly (Task 7's `resolveOrgRole` +
-- `canGrantRole`), this migration is the fail-safe against any other write
-- path (a future admin RPC, a manual SQL edit, a bug) reaching the same
-- table without re-deriving the same rule.
--
-- Re-review found the above incomplete, plus a related RLS gap:
--
-- 3. (Critical, residual) The [1,10] cap in #2(b) is gated on
--    `not new.is_system` -- an INSERT that sets `is_system = true` directly
--    skips it entirely (and skips the immutable-rank check too, which is
--    gated on `old.is_system`/UPDATE and never fires on INSERT). Full
--    exploit chain: an org_admin (who holds `roles.edit` via
--    `org_roles_write_editor`'s RLS) POSTs a new `organization_roles` row
--    `{rank: 999, is_system: true}`, grants it every capability via
--    `role_permissions` (which they can also write, same policy family),
--    PATCHes their own membership to that role_id, and now resolves at
--    rank 999 -- enough to pass `canGrantRole` against `owner` (rank 100)
--    and, e.g., email-takeover an owner via `updateMemberProfileAction`.
--    Fixed by rejecting `is_system = true` on INSERT unless the trusted
--    `rbac.seeding` flag is set (the same flag `protect_owner_grants()`
--    already relies on, set by `seed_system_roles()` at the top of its
--    body -- confirmed still there, unchanged by this migration).
--
-- 4. (Important) `org_members_insert_admin` / `org_members_update_admin` /
--    `invitations_insert_admin` (originally `20260624000002_id_access_rls.sql`,
--    re-pointed at `has_permission` by `20260901000002`) still rank-gate
--    their `with check` via the legacy `role_rank(text)` function -- a
--    hardcoded, org-agnostic keyword match (`case role when 'owner' then
--    100 ... else 0 end`). Every custom role's key is unknown to it and
--    falls into `else 0`, so its rank comparison is meaningless for
--    dynamic RBAC. Two new `security definer` helpers,
--    `org_role_rank(org, role_key)` (looks up the row in that org's
--    `organization_roles`) and `caller_role_rank(org)` (the caller's own
--    active-membership rank in that org, via `role_id`), replace
--    `role_rank(...)` in all three policies' `with check`. The
--    `has_permission(...)` capability gate on each policy is unchanged.
--    `role_rank(text)` itself is left in place (not dropped) -- nothing
--    else references it after this migration, but dropping a function
--    used by the RLS engine's plan cache is unnecessary risk for a
--    security migration; it becomes dead code.

begin;

-- ---------------------------------------------------------------------------
-- 1. Drop the legacy role-enum CHECK constraints.
-- ---------------------------------------------------------------------------
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.invitations drop constraint if exists invitations_role_check;

-- ---------------------------------------------------------------------------
-- 2. Immutable system-role rank + capped custom-role rank.
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

  if tg_op = 'INSERT' and new.is_system and current_setting('rbac.seeding', true) is distinct from 'on' then
    -- Must run before the [1,10] cap below: every app-reachable INSERT
    -- (org_roles_write_editor's RLS lets any roles.edit holder insert)
    -- always hits the cap, never the wide-open system-role path. Only
    -- `seed_system_roles()` (which sets this flag itself, is
    -- security definer, and is never granted to `authenticated`) may
    -- create a system role.
    raise exception 'is_system may only be set by the seeder';
  end if;

  if tg_op = 'UPDATE' and new.is_system <> old.is_system then
    -- Closes a bypass of both checks below: flipping a custom role to
    -- is_system = true (or a system role to false) would otherwise skip
    -- the immutable-rank check (gated on old.is_system) AND the [1,10] cap
    -- (gated on not new.is_system) in the same statement. is_system is
    -- seeder-only and never legitimately changes after creation.
    raise exception 'is_system cannot be changed';
  end if;

  if tg_op = 'UPDATE' and old.is_system then
    if new.key <> old.key or new.name <> old.name then
      raise exception 'system roles cannot be renamed';
    end if;
    -- `rank` feeds canGrantRole() on the app side; a mutable system rank
    -- would let anyone with roles.edit re-order the fixed ladder every
    -- custom role's rank cap is measured against.
    if new.rank <> old.rank then
      raise exception 'system role rank is immutable';
    end if;
  end if;

  if not new.is_system then
    -- Matches the plan's custom-role rank rule (created rank =
    -- min(actorRank-1, 10), floor 1): a custom role must always sit below
    -- every system role (lowest is driver at rank 30), so it can never be
    -- used to grant or manage a system-ranked member.
    if new.rank < 1 or new.rank > 10 then
      raise exception 'custom role rank must be between 1 and 10';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists organization_roles_protect on public.organization_roles;
create trigger organization_roles_protect before insert or update or delete on public.organization_roles
  for each row execute function public.protect_system_roles();

-- ---------------------------------------------------------------------------
-- 3. Org-scoped rank helpers, replacing the legacy global `role_rank(text)`
--    in the three RLS policies that still used it.
-- ---------------------------------------------------------------------------
create or replace function public.org_role_rank(target_org uuid, role_key text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.rank from public.organization_roles r
       where r.organization_id = target_org and r.key = role_key),
    0
  );
$$;

revoke all on function public.org_role_rank(uuid, text) from public;
grant execute on function public.org_role_rank(uuid, text) to authenticated;

create or replace function public.caller_role_rank(target_org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.rank
       from public.organization_members m
       join public.organization_roles r on r.id = m.role_id
       where m.organization_id = target_org
         and m.user_id = (select auth.uid())
         and m.status = 'active'
       limit 1),
    0
  );
$$;

revoke all on function public.caller_role_rank(uuid) from public;
grant execute on function public.caller_role_rank(uuid) to authenticated;

-- org_members_insert_admin / org_members_update_admin / invitations_insert_admin:
-- verbatim from 20260901000002_dynamic_rbac_enforcement.sql except
-- `role_rank(role) <= role_rank((select m.role from ...))` ->
-- `org_role_rank(<org>, role) <= caller_role_rank(<org>)`. The
-- has_permission(...) capability gate on each is untouched. Owner
-- protection is preserved as a corollary, not a separate branch: owner's
-- rank is 100, the highest any org can seed, so a non-owner caller's
-- caller_role_rank() is always < 100 and the <= comparison rejects setting
-- anyone to the owner role -- verified live below.
drop policy if exists org_members_insert_admin on public.organization_members;
create policy org_members_insert_admin
  on public.organization_members for insert to authenticated
  with check (
    public.has_permission(organization_id, 'membership.role.change', 'use')
    and public.org_role_rank(organization_id, role) <= public.caller_role_rank(organization_id)
  );

drop policy if exists org_members_update_admin on public.organization_members;
create policy org_members_update_admin
  on public.organization_members for update to authenticated
  using (public.has_permission(organization_id, 'membership.role.change', 'use'))
  with check (
    public.has_permission(organization_id, 'membership.role.change', 'use')
    and public.org_role_rank(organization_id, role) <= public.caller_role_rank(organization_id)
  );

drop policy if exists invitations_insert_admin on public.invitations;
create policy invitations_insert_admin
  on public.invitations for insert to authenticated
  with check (
    public.has_permission(organization_id, 'membership.invite', 'use')
    and public.org_role_rank(invitations.organization_id, role) <= public.caller_role_rank(invitations.organization_id)
  );

commit;
