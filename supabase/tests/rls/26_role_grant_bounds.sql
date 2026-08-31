-- supabase/tests/rls/26_role_grant_bounds.sql
-- Coverage for the bound on `roles.edit` (20260901000005_bound_role_grants.sql).
--
-- `role_permissions` is granted directly to `authenticated`, so RLS is the
-- only thing standing between a role editor and an arbitrary grant. Before
-- this migration, holding `roles:edit` meant "grant anything to anyone":
-- the policy checked that one capability and nothing else, so a custom role
-- given only the roles editor could hand itself `data_console.manage` or
-- `users:delete` and walk up to full admin without ever changing its rank.
--
-- Pinned down here:
--   * an editor cannot grant a capability it does not itself hold
--   * an editor can still grant one it does hold
--   * revoking is always allowed (de-escalation is never an escalation)
--   * an editor cannot reach a role ranked above its own, neither the
--     role's grants nor the role row itself
--   * reset_role_to_defaults restores the documented baseline even when
--     that baseline includes a capability the caller lacks
--
-- Note on RLS failure modes: a blocked INSERT raises 42501, while a blocked
-- UPDATE or DELETE is filtered by the USING clause and silently affects
-- zero rows. Tests below assert whichever of the two applies.

begin;

select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS). Creating the org
-- fires the seeder, so the seven system roles already exist afterwards.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('bb000000-0000-0000-0000-00000000000a', 'role-bounds-test-org', 'Role Bounds Test Org')
on conflict (id) do nothing;

-- 001 owner, 002 org_admin, 003 holds a narrow custom "role editor" role.
insert into auth.users (id)
values
  ('bb000000-0000-0000-0000-000000000001'),
  ('bb000000-0000-0000-0000-000000000002'),
  ('bb000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

-- e1: a role at the bottom of the ladder whose only power is editing roles
--     -- exactly the delegation the old policy turned into full admin.
-- e2: a same-rank role to aim grants at.
-- e3: a role ranked above e1, to test the ceiling.
insert into public.organization_roles (id, organization_id, key, name, rank, is_system)
values
  ('bb000000-0000-0000-0000-0000000000e1',
   'bb000000-0000-0000-0000-00000000000a', 'role-editor', 'Role Editor', 5, false),
  ('bb000000-0000-0000-0000-0000000000e2',
   'bb000000-0000-0000-0000-00000000000a', 'clerk', 'Clerk', 5, false),
  ('bb000000-0000-0000-0000-0000000000e3',
   'bb000000-0000-0000-0000-00000000000a', 'lead-clerk', 'Lead Clerk', 8, false)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, resource, action, granted)
values
  ('bb000000-0000-0000-0000-0000000000e1', 'roles', 'view', true),
  ('bb000000-0000-0000-0000-0000000000e1', 'roles', 'edit', true),
  ('bb000000-0000-0000-0000-0000000000e1', 'products', 'view', true)
on conflict (role_id, resource, action) do update set granted = excluded.granted;

insert into public.organization_members (organization_id, user_id, role, role_id, status)
values
  ('bb000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000001', 'owner',
   (select id from public.organization_roles
      where organization_id = 'bb000000-0000-0000-0000-00000000000a' and key = 'owner'), 'active'),
  ('bb000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000002', 'org_admin',
   (select id from public.organization_roles
      where organization_id = 'bb000000-0000-0000-0000-00000000000a' and key = 'org_admin'), 'active'),
  ('bb000000-0000-0000-0000-00000000000a', 'bb000000-0000-0000-0000-000000000003', 'seller',
   'bb000000-0000-0000-0000-0000000000e1', 'active')
on conflict (organization_id, user_id) do nothing;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1-4: the narrow role editor is bounded by its own authority.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('bb000000-0000-0000-0000-000000000003');

-- 1: cannot hand out a capability it does not hold -- the whole escalation.
select throws_ok(
  $$ insert into public.role_permissions (role_id, resource, action, granted)
     values ('bb000000-0000-0000-0000-0000000000e2', 'users', 'delete', true) $$,
  '42501',
  null,
  'role editor cannot grant a capability it does not hold');

-- 2: cannot escalate itself either -- same rule, its own role as the target.
select throws_ok(
  $$ insert into public.role_permissions (role_id, resource, action, granted)
     values ('bb000000-0000-0000-0000-0000000000e1', 'data_console.manage', 'use', true) $$,
  '42501',
  null,
  'role editor cannot grant itself a capability it does not hold');

-- 3: a capability it does hold still passes, so delegation keeps working.
select lives_ok(
  $$ insert into public.role_permissions (role_id, resource, action, granted)
     values ('bb000000-0000-0000-0000-0000000000e2', 'products', 'view', true) $$,
  'role editor can grant a capability it does hold');

-- 4: revoking needs no matching grant -- de-escalation is never escalation.
select lives_ok(
  $$ insert into public.role_permissions (role_id, resource, action, granted)
     values ('bb000000-0000-0000-0000-0000000000e2', 'orders', 'delete', false) $$,
  'role editor can revoke a capability it does not hold');

-- ---------------------------------------------------------------------------
-- 5-7: rank ceiling. `roles:edit` is a capability this editor *does* hold,
-- so a refusal here isolates the rank rule from the self-authority rule.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.role_permissions (role_id, resource, action, granted)
     select id, 'roles', 'edit', true from public.organization_roles
      where organization_id = 'bb000000-0000-0000-0000-00000000000a' and key = 'seller' $$,
  '42501',
  null,
  'rank-5 editor cannot grant into the rank-60 seller role');

-- The ceiling covers the role row itself, not just its grants. A blocked
-- UPDATE is filtered rather than raised, so assert the row is untouched.
select lives_ok(
  $$ update public.organization_roles set name = 'Hijacked'
      where id = 'bb000000-0000-0000-0000-0000000000e3' $$,
  'renaming a higher-ranked role is filtered, not an error');

select is(
  (select name from public.organization_roles
     where id = 'bb000000-0000-0000-0000-0000000000e3'),
  'Lead Clerk',
  'rank-5 editor cannot rename the rank-8 role above it');

-- ---------------------------------------------------------------------------
-- 8-9: org_admin keeps full reach downward; owner grants stay locked.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('bb000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ insert into public.role_permissions (role_id, resource, action, granted)
     values ('bb000000-0000-0000-0000-0000000000e2', 'orders', 'view', true)
     on conflict (role_id, resource, action) do update set granted = excluded.granted $$,
  'org_admin can still grant to a custom role');

select throws_ok(
  $$ insert into public.role_permissions (role_id, resource, action, granted)
     select id, 'leave', 'view', false from public.organization_roles
      where organization_id = 'bb000000-0000-0000-0000-00000000000a' and key = 'owner' $$,
  null,
  null,
  'owner grants stay locked even against org_admin');

-- ---------------------------------------------------------------------------
-- 10: reset restores the documented baseline even though the owner running
--     it does not hold data_console.manage, which is in admin's defaults.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('bb000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.reset_role_to_defaults(
       (select id from public.organization_roles
          where organization_id = 'bb000000-0000-0000-0000-00000000000a' and key = 'org_admin')) $$,
  'owner can reset the admin role to defaults it cannot itself grant');

select * from finish();
rollback;
