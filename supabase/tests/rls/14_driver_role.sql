-- supabase/tests/rls/14_driver_role.sql
-- Coverage for 20260821000002_driver_role.sql.
--
-- The whole point of the driver role is what it CANNOT see. A driver signs in
-- on a phone, often in a customer's car park, so "any active member of the org"
-- is the wrong blast radius: these assertions pin the driver to their own run
-- and check that the office roles kept everything they had.

begin;

select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('e0000000-0000-0000-0000-00000000000a', 'driver-role-test-org', 'Driver Role Test Org')
on conflict (id) do nothing;

-- 001 owner, 002 driver on run A, 003 driver with no run.
insert into auth.users (id)
values
  ('e0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'driver', 'active'),
  ('e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003', 'driver', 'active')
on conflict (organization_id, user_id) do nothing;

-- Two customers: 005 is on the driver's run, 006 is not.
insert into public.customers (id, organization_id, name, phone, created_by)
values
  ('e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-00000000000a', 'On The Run', '0123456789', 'e0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-00000000000a', 'Someone Else', '0987654321', 'e0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values ('e0000000-0000-0000-0000-000000000007', 'e0000000-0000-0000-0000-00000000000a', 'Klang', true, 'e0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values
  ('e0000000-0000-0000-0000-000000000008', 'e0000000-0000-0000-0000-00000000000a', 'Lori 1', 'TRK-DR1', 'e0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000018', 'e0000000-0000-0000-0000-00000000000a', 'Lori 2', 'TRK-DR2', 'e0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('e0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000008', 1, '09:00', '12:00', 'e0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- Run A belongs to driver 002. Run B belongs to nobody.
insert into public.delivery_runs (id, organization_id, truck_id, run_date, status, driver_id)
values
  ('e0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000008', current_date + 1, 'planned', 'e0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000018', current_date + 1, 'planned', null)
on conflict (id) do nothing;

insert into public.orders (id, organization_id, customer_id, created_by, source, status, zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id, assignment_source)
values
  ('e0000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'e0000000-0000-0000-0000-000000000007', '1 Driver Street', current_date + 1, 'e0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000008', 'e0000000-0000-0000-0000-000000000010', 'manual'),
  ('e0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'e0000000-0000-0000-0000-000000000007', '2 Other Street', current_date + 1, 'e0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000018', 'e0000000-0000-0000-0000-000000000011', 'manual')
on conflict (id) do nothing;

insert into public.categories (id, organization_id, name, created_by)
values ('e0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-00000000000a', 'Ayam', 'e0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, created_by)
values ('e0000000-0000-0000-0000-000000000031', 'e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000030', 'Ayam Standard', 'e0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.order_items (id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg, fallback)
values
  ('e0000000-0000-0000-0000-000000000041', 'e0000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-000000000031', 'kg', 10, 1.5, 1.7, 'cancel'),
  ('e0000000-0000-0000-0000-000000000042', 'e0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000031', 'kg', 10, 1.5, 1.7, 'cancel')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. The driver sees their own run, and only that one.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'e0000000-0000-0000-0000-000000000002';

select results_eq(
  $$ select id from public.delivery_runs where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('e0000000-0000-0000-0000-000000000010'::uuid) $$,
  'a driver sees only the run they are driving'
);

select results_eq(
  $$ select id from public.orders where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('e0000000-0000-0000-0000-000000000021'::uuid) $$,
  'a driver sees only the orders on their run'
);

select results_eq(
  $$ select id from public.order_items $$,
  $$ values ('e0000000-0000-0000-0000-000000000041'::uuid) $$,
  'a driver sees only the lines of the orders on their run'
);

select results_eq(
  $$ select id from public.customers where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('e0000000-0000-0000-0000-000000000005'::uuid) $$,
  'a driver sees only the customers on their run, not the org customer list'
);

reset role;

-- ---------------------------------------------------------------------------
-- 2. A driver with no run assigned sees nothing at all.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'e0000000-0000-0000-0000-000000000003';

select is_empty(
  $$ select id from public.delivery_runs where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  'a driver with no run sees no runs'
);

select is_empty(
  $$ select id from public.orders where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  'a driver with no run sees no orders'
);

select is_empty(
  $$ select id from public.customers where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  'a driver with no run sees no customers'
);

reset role;

-- ---------------------------------------------------------------------------
-- 3. The office keeps everything it had.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'e0000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select count(*)::int from public.orders where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  $$ values (2) $$,
  'the owner still reads every order in the org'
);

select results_eq(
  $$ select count(*)::int from public.customers where organization_id = 'e0000000-0000-0000-0000-00000000000a' $$,
  $$ values (2) $$,
  'the owner still reads every customer in the org'
);

-- ---------------------------------------------------------------------------
-- 4. dispatch_assign_driver refuses anyone who is not an active driver here.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.dispatch_assign_driver(
       'e0000000-0000-0000-0000-000000000011',
       'e0000000-0000-0000-0000-000000000001'
     ) $$,
  'P0001',
  'invalid_driver',
  'a non-driver member cannot be put on a run as the driver'
);

select lives_ok(
  $$ select public.dispatch_assign_driver(
       'e0000000-0000-0000-0000-000000000011',
       'e0000000-0000-0000-0000-000000000003'
     ) $$,
  'the office can put a driver-role member on a run'
);

reset role;

select * from finish();
rollback;
