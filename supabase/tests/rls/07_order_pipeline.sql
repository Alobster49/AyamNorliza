-- supabase/tests/rls/07_order_pipeline.sql
-- Order pipeline schema RLS: anon gets the public zone list but not trucks;
-- buyers see only their own orders; any active org member (including
-- warehouse-only roles) can read orders but only managers can write
-- schedule tables; orders/order_items have no direct-write policies at all
-- (writes are RPC-only, added in migration 2).

begin;

select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('a0000000-0000-0000-0000-00000000000a', 'order-pipeline-test-org', 'Order Pipeline Test Org')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'), -- manager (owner)
  ('a0000000-0000-0000-0000-000000000002'), -- inventory staff
  ('a0000000-0000-0000-0000-000000000003'), -- buyer (not an org member)
  ('a0000000-0000-0000-0000-000000000010')  -- seller whose membership has expired
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'inventory', 'active')
on conflict (organization_id, user_id) do nothing;

-- Time-boxed member whose window has lapsed: status is still 'active' but
-- expires_at is in the past. RLS must treat this the same as no membership.
insert into public.organization_members (organization_id, user_id, role, status, starts_at, expires_at)
values ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000010', 'seller', 'active', now() - interval '2 days', now() - interval '1 day')
on conflict (organization_id, user_id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Test Customer', '0123456789', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', 'Active Zone', true, 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'Inactive Zone', false, 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'Truck A', 'TRK-A', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000007', 1, '09:00', '12:00', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- order_own: created_by the buyer
insert into public.orders (id, organization_id, customer_id, created_by, source, zone_id, delivery_address, delivery_date, slot_id, truck_id)
values ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'portal', 'a0000000-0000-0000-0000-000000000005', '1 Test Street', current_date + 1, 'a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

-- order_other: created_by the manager (not the buyer)
insert into public.orders (id, organization_id, customer_id, created_by, source, zone_id, delivery_address, delivery_date, slot_id, truck_id)
values ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'manual', 'a0000000-0000-0000-0000-000000000005', '2 Test Street', current_date + 1, 'a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS enabled on every new table
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where relname = 'delivery_zones' and relnamespace = 'public'::regnamespace), 'delivery_zones RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'trucks' and relnamespace = 'public'::regnamespace), 'trucks RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'truck_zones' and relnamespace = 'public'::regnamespace), 'truck_zones RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'delivery_slots' and relnamespace = 'public'::regnamespace), 'delivery_slots RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'schedule_blocks' and relnamespace = 'public'::regnamespace), 'schedule_blocks RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'delivery_runs' and relnamespace = 'public'::regnamespace), 'delivery_runs RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'orders' and relnamespace = 'public'::regnamespace), 'orders RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'order_items' and relnamespace = 'public'::regnamespace), 'order_items RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'order_tasks' and relnamespace = 'public'::regnamespace), 'order_tasks RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'order_weight_log' and relnamespace = 'public'::regnamespace), 'order_weight_log RLS is on');

-- ---------------------------------------------------------------------------
-- anon: sees the active zone via the public policy, not the inactive one,
-- and cannot read trucks at all (no anon grant, no public policy).
-- ---------------------------------------------------------------------------
set local role anon;

-- Scoped to this test's fixture org: the public policy is intentionally
-- global (no org filter, matching the contract), so an unscoped query would
-- also pick up any other org's active zones (e.g. the pilot seed data from
-- Task 3, which lands in the same database once that migration exists).
select results_eq(
  $$ select id from public.delivery_zones where organization_id = 'a0000000-0000-0000-0000-00000000000a' order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000005'::uuid) $$,
  'anon sees only the active delivery zone in this org'
);

select throws_ok(
  $$ select count(*) from public.trucks $$,
  '42501',
  null,
  'anon cannot read trucks'
);

reset role;

-- ---------------------------------------------------------------------------
-- buyer: sees only their own order via orders_select_buyer.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000003';

select results_eq(
  $$ select id from public.orders order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000009'::uuid) $$,
  'buyer sees only their own order, not others in the org'
);

reset role;

-- ---------------------------------------------------------------------------
-- inventory-role member: reads all org orders (any active member can), but
-- cannot update them directly -- orders has no write policy, RPC-only.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000002';

select results_eq(
  $$ select id from public.orders order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000009'::uuid), ('a0000000-0000-0000-0000-00000000000b'::uuid) $$,
  'inventory-role member reads every order in the org'
);

select throws_ok(
  $$ update public.orders set notes = 'tampered' where id = 'a0000000-0000-0000-0000-000000000009' $$,
  '42501',
  null,
  'inventory-role member cannot update orders directly (no write policy)'
);

reset role;

-- ---------------------------------------------------------------------------
-- manager can insert a delivery_zone; inventory role cannot.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ insert into public.delivery_zones (id, organization_id, name, created_by) values ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000a', 'Manager Zone', 'a0000000-0000-0000-0000-000000000001') $$,
  'manager (owner) can insert a delivery_zone'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ insert into public.delivery_zones (id, organization_id, name, created_by) values ('a0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000a', 'Inventory Zone', 'a0000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'inventory-role member cannot insert a delivery_zone'
);

reset role;

-- ---------------------------------------------------------------------------
-- Expired membership: status = 'active' but expires_at is in the past. The
-- org-membership subqueries must additionally require
-- (expires_at is null or expires_at > now()), matching
-- public.is_active_org_member/has_org_role -- otherwise a time-boxed member
-- keeps access after their window lapses.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000010';

select is_empty(
  $$ select id from public.orders $$,
  'expired seller membership cannot read any order in the org'
);

select throws_ok(
  $$ insert into public.delivery_zones (id, organization_id, name, created_by) values ('a0000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-00000000000a', 'Expired Seller Zone', 'a0000000-0000-0000-0000-000000000010') $$,
  '42501',
  null,
  'expired seller membership cannot insert a delivery_zone'
);

reset role;

select * from finish();
rollback;
