-- supabase/tests/rls/11_logistics_dispatch.sql
-- Dispatch logistics schema (20260814000001): table-GRANT regression for
-- facilities/bays/zone_postcode_ranges (the C1 fix -- without the explicit
-- GRANTs added there, authenticated hits 42501 before RLS is even
-- evaluated), role-gated writes, cross-org read isolation, the
-- auto-never-overrides-manual guarantee on dispatch_assign_order, the
-- release-on-depart behavior of dispatch_depart_truck (the I2 fix), and
-- place_order persisting p_postcode (20260814000002).

begin;

select plan(16);

create temporary table _scratch (label text primary key, order_id uuid);
grant select, insert on _scratch to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, bypasses RLS/grants)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values
  ('c0000000-0000-0000-0000-00000000000a', 'logistics-dispatch-test-org', 'Logistics Dispatch Test Org'),
  ('c0000000-0000-0000-0000-00000000000b', 'logistics-dispatch-test-org-b', 'Logistics Dispatch Test Org B')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('c0000000-0000-0000-0000-000000000001'), -- owner (org A)
  ('c0000000-0000-0000-0000-000000000002'), -- seller (org A)
  ('c0000000-0000-0000-0000-000000000003')  -- logistics (org A)
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'seller', 'active'),
  ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003', 'logistics', 'active')
on conflict (organization_id, user_id) do nothing;

-- Facility/bay for org A, plus a facility for org B used only to prove
-- cross-org isolation (a real row that must never leak into org A's view).
insert into public.facilities (id, organization_id, name, address_line, postcode, state, created_by)
values
  ('c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-00000000000a', 'Test Facility', '1 Test Street', '82000', 'Johor', 'c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-00000000000b', 'Other Org Facility', '2 Other Street', '83000', 'Johor', null)
on conflict (id) do nothing;

insert into public.bays (id, organization_id, facility_id, name, created_by)
values ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000010', 'Bay 1', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, created_by)
values ('c0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-00000000000a', 'Dispatch Zone', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.zone_postcode_ranges (id, organization_id, zone_id, postcode_start, postcode_end, created_by)
values ('c0000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000020', '82000', '82099', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.categories (id, organization_id, name, is_active, created_by)
values ('c0000000-0000-0000-0000-000000000030', 'c0000000-0000-0000-0000-00000000000a', 'Whole Chicken', true, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, is_active, created_by)
values ('c0000000-0000-0000-0000-000000000031', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000030', 'Whole Chicken', true, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('c0000000-0000-0000-0000-000000000040', 'c0000000-0000-0000-0000-00000000000a', 'Dispatch Test Customer', '0123456789', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values
  ('c0000000-0000-0000-0000-000000000050', 'c0000000-0000-0000-0000-00000000000a', 'Dispatch Truck 1', 'DSP-1', 'c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000051', 'c0000000-0000-0000-0000-00000000000a', 'Dispatch Truck 2', 'DSP-2', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.truck_zones (truck_id, zone_id, organization_id)
values
  ('c0000000-0000-0000-0000-000000000050', 'c0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-00000000000a'),
  ('c0000000-0000-0000-0000-000000000051', 'c0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-00000000000a')
on conflict do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values (
  'c0000000-0000-0000-0000-000000000060',
  'c0000000-0000-0000-0000-00000000000a',
  'c0000000-0000-0000-0000-000000000050',
  extract(dow from current_date + 1)::smallint,
  '09:00', '12:00',
  'c0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

-- Manually-assigned ticket (truck 1), used to prove auto never overrides manual.
insert into public.orders (
  id, organization_id, customer_id, created_by, source, status,
  zone_id, delivery_address, delivery_date, slot_id, truck_id, assignment_source
) values (
  'c0000000-0000-0000-0000-000000000070', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000040',
  'c0000000-0000-0000-0000-000000000001', 'manual', 'confirmed',
  'c0000000-0000-0000-0000-000000000020', '1 Manual Street', current_date + 1, 'c0000000-0000-0000-0000-000000000060',
  'c0000000-0000-0000-0000-000000000050', 'manual'
)
on conflict (id) do nothing;

-- A planned run on truck 2 with a not-ready ticket (must be released on
-- depart) and a ready ticket (must stay attached).
insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
values ('c0000000-0000-0000-0000-000000000080', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000051', current_date + 1, 'planned')
on conflict (id) do nothing;

insert into public.orders (
  id, organization_id, customer_id, created_by, source, status,
  zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id, assignment_source
) values
  (
    'c0000000-0000-0000-0000-000000000081', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000040',
    'c0000000-0000-0000-0000-000000000001', 'manual', 'confirmed',
    'c0000000-0000-0000-0000-000000000020', '2 Depart Street', current_date + 1, 'c0000000-0000-0000-0000-000000000060',
    'c0000000-0000-0000-0000-000000000051', 'c0000000-0000-0000-0000-000000000080', 'manual'
  ),
  (
    'c0000000-0000-0000-0000-000000000082', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000040',
    'c0000000-0000-0000-0000-000000000001', 'manual', 'ready',
    'c0000000-0000-0000-0000-000000000020', '3 Depart Street', current_date + 1, 'c0000000-0000-0000-0000-000000000060',
    'c0000000-0000-0000-0000-000000000051', 'c0000000-0000-0000-0000-000000000080', 'auto'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Grant reachability (C1 regression): authenticated can actually select
-- facilities/bays/zone_postcode_ranges through the GRANT, not just RLS.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select id from public.facilities where organization_id = 'c0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('c0000000-0000-0000-0000-000000000010'::uuid) $$,
  'authenticated can select facilities (grant + RLS reachable)'
);

select results_eq(
  $$ select id from public.bays where organization_id = 'c0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('c0000000-0000-0000-0000-000000000011'::uuid) $$,
  'authenticated can select bays (grant + RLS reachable)'
);

select results_eq(
  $$ select id from public.zone_postcode_ranges where organization_id = 'c0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('c0000000-0000-0000-0000-000000000021'::uuid) $$,
  'authenticated can select zone_postcode_ranges (grant + RLS reachable)'
);

reset role;

-- ---------------------------------------------------------------------------
-- 2. facility update: rejected for seller, allowed for owner.
--
-- facilities is grant-open to authenticated (C1's fix covers every org
-- role, since a Postgres GRANT can't distinguish app-level org roles), so a
-- seller's UPDATE clears the GRANT layer and instead gets filtered out by
-- the facilities_update USING clause -- it matches zero rows rather than
-- raising 42501 (that's the orders-table RPC-only pattern, not this one).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000002';

select is_empty(
  $$ update public.facilities set name = 'Hacked' where id = 'c0000000-0000-0000-0000-000000000010' returning id $$,
  'seller update matches zero rows (blocked by facilities_update RLS)'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ update public.facilities set name = 'Updated Facility' where id = 'c0000000-0000-0000-0000-000000000010' $$,
  'owner can update a facility'
);

reset role;

select results_eq(
  $$ select name from public.facilities where id = 'c0000000-0000-0000-0000-000000000010' $$,
  $$ values ('Updated Facility'::text) $$,
  'facility name reflects the owner update'
);

-- ---------------------------------------------------------------------------
-- 3. bays insert: rejected for logistics role (not a manager role).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000003';

select throws_ok(
  $$
    insert into public.bays (organization_id, facility_id, name)
    values ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000010', 'Bay 2')
  $$,
  '42501',
  null,
  'logistics-role member cannot insert a bay'
);

reset role;

-- ---------------------------------------------------------------------------
-- 4. Cross-org read isolation: org A owner cannot see org B's facility.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000001';

select is_empty(
  $$ select id from public.facilities where organization_id = 'c0000000-0000-0000-0000-00000000000b' $$,
  'org A owner cannot read org B''s facility'
);

reset role;

-- ---------------------------------------------------------------------------
-- 5. dispatch_assign_order: p_source='auto' never overrides a manual
-- assignment -- assignment_source and truck stay put.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000003';

select lives_ok(
  $$ select public.dispatch_assign_order('c0000000-0000-0000-0000-000000000070', 'c0000000-0000-0000-0000-000000000051', 'auto') $$,
  'dispatch_assign_order(auto) against a manually-assigned order does not raise'
);

reset role;

select results_eq(
  $$ select assignment_source::text, truck_id from public.orders where id = 'c0000000-0000-0000-0000-000000000070' $$,
  $$ values ('manual'::text, 'c0000000-0000-0000-0000-000000000050'::uuid) $$,
  'auto assignment does not override the existing manual source/truck'
);

-- ---------------------------------------------------------------------------
-- 6. dispatch_depart_truck: releases the non-ready ticket back to the pool
-- and departs the run, while leaving the ready ticket attached.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000003';

select lives_ok(
  $$ select public.dispatch_depart_truck('c0000000-0000-0000-0000-000000000051', current_date + 1) $$,
  'dispatch_depart_truck departs the run'
);

reset role;

select results_eq(
  $$ select status::text from public.delivery_runs where id = 'c0000000-0000-0000-0000-000000000080' $$,
  $$ values ('departed'::text) $$,
  'the run is departed'
);

select results_eq(
  $$ select run_id, assignment_source::text from public.orders where id = 'c0000000-0000-0000-0000-000000000081' $$,
  $$ values (null::uuid, 'none'::text) $$,
  'the non-ready ticket is released back to the pool'
);

select results_eq(
  $$ select run_id, status::text from public.orders where id = 'c0000000-0000-0000-0000-000000000082' $$,
  $$ values ('c0000000-0000-0000-0000-000000000080'::uuid, 'ready'::text) $$,
  'the ready ticket stays attached to the departed run'
);

-- ---------------------------------------------------------------------------
-- 7. place_order persists p_postcode.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'c0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'postcode', public.place_order(
      'c0000000-0000-0000-0000-00000000000a'::uuid,
      'c0000000-0000-0000-0000-000000000020'::uuid,
      'c0000000-0000-0000-0000-000000000060'::uuid,
      current_date + 1,
      '4 Postcode Street',
      null,
      '[{"productId":"c0000000-0000-0000-0000-000000000031","mode":"kg","quantity":1.5,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb,
      'c0000000-0000-0000-0000-000000000040'::uuid,
      '82000'
    )
  $$,
  'place_order with a manual customer and p_postcode succeeds'
);

reset role;

select results_eq(
  $$ select postcode from public.orders where id = (select order_id from _scratch where label = 'postcode') $$,
  $$ values ('82000'::text) $$,
  'place_order persists p_postcode on the order row'
);

select * from finish();
rollback;
