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

commit;
