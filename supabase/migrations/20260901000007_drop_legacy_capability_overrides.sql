-- Task 13, part 2: remove the superseded capability-override subsystem.
--
-- `role_capability_overrides` was the MOD-19 model: a fixed role enum plus
-- per-org boolean overrides, resolved by `effective_capabilities()`. Dynamic
-- RBAC replaced it wholesale with `organization_roles` / `role_permissions`,
-- and 20260901000001 said so in a comment -- "table dropped in the cleanup
-- migration, Task 13" -- but no such migration was ever written. Until now
-- the table, its four RLS policies and a `security definer` RPC granted to
-- `authenticated` were all still live, with no production caller: the app's
-- only entry points (`resolveCapabilitiesForOrg` / `canForOrg`) were reached
-- exclusively from their own unit test, and are deleted in the same change.
--
-- Its RLS policies were also quietly broken. They named `owner` only, and
-- once 20260901000002 redefined `has_org_role` without the old
-- `org_admin -> owner` aliasing, an Admin lost access to a table nothing
-- reads. That is the state being deleted, not one worth repairing.
--
-- `role_rank(text)` goes with it: 20260901000003 replaced its three callers
-- with the org-scoped `org_role_rank` / `caller_role_rank` and noted that it
-- "becomes dead code", keeping it only to avoid touching the RLS plan cache
-- in that migration.
--
-- Precedent for this shape of cleanup: 20260711000001_cleanup_unused_tables
-- dropped 31 dead MOD-02/03/04 tables in dependency order.

begin;

-- The RPCs first: both overloads read the table.
drop function if exists public.effective_capabilities(uuid, text);
drop function if exists public.effective_capabilities(uuid);

-- Policies go with the table, but drop them explicitly so the intent is
-- visible in the migration rather than implied by the cascade.
drop policy if exists role_caps_select_owner on public.role_capability_overrides;
drop policy if exists role_caps_insert_owner on public.role_capability_overrides;
drop policy if exists role_caps_update_owner on public.role_capability_overrides;
drop policy if exists role_caps_delete_owner on public.role_capability_overrides;

drop table if exists public.role_capability_overrides;

-- Superseded by org_role_rank(uuid, text) / caller_role_rank(uuid).
drop function if exists public.role_rank(text);

commit;
