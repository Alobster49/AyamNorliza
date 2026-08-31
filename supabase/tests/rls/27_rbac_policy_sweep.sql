-- supabase/tests/rls/27_rbac_policy_sweep.sql
-- Coverage for 20260901000006_rbac_policy_sweep.sql.
--
-- The dynamic-RBAC migrations rewrote the RPC layer onto `has_permission()`
-- but never touched the table policies, which kept testing the legacy
-- `organization_members.role` text against a hardcoded list. The Roles &
-- Permissions page therefore lied in both directions: a grant it showed as
-- given was refused by RLS, and one it showed as revoked still worked.
--
-- These tests state that contract directly -- the grant decides, not the
-- role name.

begin;

select plan(8);

-- ---------------------------------------------------------------------------
-- Fixtures. Creating the org seeds the seven system roles.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('ca000000-0000-0000-0000-00000000000a', 'policy-sweep-test-org', 'Policy Sweep Org')
on conflict (id) do nothing;

insert into auth.users (id)
values
  ('ca000000-0000-0000-0000-000000000001'),  -- seller, later stripped of products:edit
  ('ca000000-0000-0000-0000-000000000002'),  -- custom "catalog editor" role
  ('ca000000-0000-0000-0000-000000000003')   -- inventory / Worker
on conflict (id) do nothing;

-- A custom role holding catalog and customer grants but named nothing the
-- old hardcoded lists would recognise.
insert into public.organization_roles (id, organization_id, key, name, rank, is_system)
values ('ca000000-0000-0000-0000-0000000000e1',
        'ca000000-0000-0000-0000-00000000000a', 'catalog-editor', 'Catalog Editor', 5, false)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, resource, action, granted)
values
  ('ca000000-0000-0000-0000-0000000000e1', 'products', 'view', true),
  ('ca000000-0000-0000-0000-0000000000e1', 'products', 'edit', true),
  ('ca000000-0000-0000-0000-0000000000e1', 'customers', 'view', true),
  ('ca000000-0000-0000-0000-0000000000e1', 'customers', 'add', true)
on conflict (role_id, resource, action) do update set granted = excluded.granted;

-- The seller role keeps its seeded grants except the catalog writes, which
-- an admin has revoked through the roles editor.
update public.role_permissions set granted = false
 where role_id = (select id from public.organization_roles
                    where organization_id = 'ca000000-0000-0000-0000-00000000000a' and key = 'seller')
   and resource = 'products' and action in ('edit', 'add');

insert into public.organization_members (organization_id, user_id, role, role_id, status)
values
  ('ca000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-000000000001', 'seller',
   (select id from public.organization_roles
      where organization_id = 'ca000000-0000-0000-0000-00000000000a' and key = 'seller'), 'active'),
  ('ca000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-000000000002', 'seller',
   'ca000000-0000-0000-0000-0000000000e1', 'active'),
  ('ca000000-0000-0000-0000-00000000000a', 'ca000000-0000-0000-0000-000000000003', 'inventory',
   (select id from public.organization_roles
      where organization_id = 'ca000000-0000-0000-0000-00000000000a' and key = 'inventory'), 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.categories (id, organization_id, name, display_order, is_active)
values ('ca000000-0000-0000-0000-0000000000c1', 'ca000000-0000-0000-0000-00000000000a', 'Whole', 1, true)
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, is_active)
values ('ca000000-0000-0000-0000-0000000000b1', 'ca000000-0000-0000-0000-00000000000a',
        'ca000000-0000-0000-0000-0000000000c1', 'Ayam Standard', true)
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active)
values ('ca000000-0000-0000-0000-0000000000d1', 'ca000000-0000-0000-0000-00000000000a', 'Zone A', true)
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, code, name, capacity_kg, is_active)
values ('ca000000-0000-0000-0000-0000000000f1', 'ca000000-0000-0000-0000-00000000000a',
        'TRK-1', 'Truck 1', 1000, true)
on conflict (id) do nothing;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1-3: a grant the roles editor shows as given is honoured, whatever the
--      role is called.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('ca000000-0000-0000-0000-000000000002');

select lives_ok(
  $$ update public.products set name = 'Ayam Premium'
      where id = 'ca000000-0000-0000-0000-0000000000b1' $$,
  'a custom role holding products:edit may update a product');

select is(
  (select name from public.products where id = 'ca000000-0000-0000-0000-0000000000b1'),
  'Ayam Premium',
  'and the update actually landed, rather than being filtered to zero rows');

select lives_ok(
  $$ insert into public.customers (organization_id, name, phone, created_by)
     values ('ca000000-0000-0000-0000-00000000000a', 'Pak Din', '0123456789',
             'ca000000-0000-0000-0000-000000000002') $$,
  'a custom role holding customers:add may create a customer');

-- ---------------------------------------------------------------------------
-- 4-6: a grant the roles editor shows as revoked is actually refused, even
--      for a role the old hardcoded list named outright.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('ca000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ update public.products set name = 'Renamed By Seller'
      where id = 'ca000000-0000-0000-0000-0000000000b1' $$,
  'the seller''s blocked update is filtered, not an error');

select is(
  (select name from public.products where id = 'ca000000-0000-0000-0000-0000000000b1'),
  'Ayam Premium',
  'a seller whose products:edit was revoked cannot rename a product');

-- Inserts take the same path and surface the refusal as 42501 rather than
-- filtering to zero rows.
select throws_ok(
  $$ insert into public.products (organization_id, category_id, name, is_active)
     values ('ca000000-0000-0000-0000-00000000000a',
             'ca000000-0000-0000-0000-0000000000c1', 'Sneaked In', true) $$,
  '42501',
  null,
  'a seller whose products:add was revoked cannot create a product');

-- ---------------------------------------------------------------------------
-- 7-8: delivery setup writes follow delivery_runs, and a Worker (inventory)
--      holds none of them.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('ca000000-0000-0000-0000-000000000003');

select throws_ok(
  $$ insert into public.trucks (organization_id, code, name, capacity_kg, is_active)
     values ('ca000000-0000-0000-0000-00000000000a', 'TRK-9', 'Truck 9', 900, true) $$,
  '42501',
  null,
  'a Worker cannot add a truck');

select pg_temp.impersonate('ca000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.trucks (organization_id, code, name, capacity_kg, is_active)
     values ('ca000000-0000-0000-0000-00000000000a', 'TRK-8', 'Truck 8', 800, true) $$,
  'a seller holding delivery_runs:add may add a truck');

select * from finish();
rollback;
