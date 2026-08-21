-- supabase/tests/rls/13_run_sequence.sql
-- Coverage for 20260821000001_run_sequence.sql: the route order behind the
-- redesigned Delivery runs screen.
--
-- Two mechanisms have to hold together. The trigger keeps run_sequence honest
-- whenever an order joins or leaves a run, and dispatch_reorder_run rewrites a
-- whole run at once -- refusing a stale list, a completed run, or a caller
-- without a manager/logistics role.

begin;

select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('d0000000-0000-0000-0000-00000000000a', 'run-sequence-test-org', 'Run Sequence Test Org')
on conflict (id) do nothing;

-- 001 owner, 002 seller, 003 outsider (no membership).
insert into auth.users (id)
values
  ('d0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('d0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('d0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'seller', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('d0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-00000000000a', 'Warung Cik Ros', '0123456789', 'd0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values ('d0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-00000000000a', 'Shah Alam', true, 'd0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values
  ('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-00000000000a', 'Lori 1', 'TRK-RS1', 'd0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000017', 'd0000000-0000-0000-0000-00000000000a', 'Lori 2', 'TRK-RS2', 'd0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('d0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000007', 1, '09:00', '12:00', 'd0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- Two runs: 010 is live, 011 is already completed.
insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
values
  ('d0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000007', current_date + 1, 'planned'),
  ('d0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000017', current_date + 1, 'completed')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Trigger: orders joining a run are numbered 1, 2, 3 in arrival order.
-- ---------------------------------------------------------------------------
insert into public.orders (id, organization_id, customer_id, created_by, source, status, zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id, assignment_source)
values
  ('d0000000-0000-0000-0000-000000000021', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'd0000000-0000-0000-0000-000000000006', '1 Test Street', current_date + 1, 'd0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000010', 'manual'),
  ('d0000000-0000-0000-0000-000000000022', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'd0000000-0000-0000-0000-000000000006', '2 Test Street', current_date + 1, 'd0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000010', 'manual'),
  ('d0000000-0000-0000-0000-000000000023', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'd0000000-0000-0000-0000-000000000006', '3 Test Street', current_date + 1, 'd0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000010', 'manual')
on conflict (id) do nothing;

select results_eq(
  $$ select id, run_sequence from public.orders where run_id = 'd0000000-0000-0000-0000-000000000010' order by run_sequence $$,
  $$ values
      ('d0000000-0000-0000-0000-000000000021'::uuid, 1),
      ('d0000000-0000-0000-0000-000000000022'::uuid, 2),
      ('d0000000-0000-0000-0000-000000000023'::uuid, 3) $$,
  'orders joining a run are appended in arrival order'
);

-- ---------------------------------------------------------------------------
-- 2. Trigger: an order taken off a run loses its position.
-- ---------------------------------------------------------------------------
update public.orders set run_id = null where id = 'd0000000-0000-0000-0000-000000000023';

select is(
  (select run_sequence from public.orders where id = 'd0000000-0000-0000-0000-000000000023'),
  null,
  'an order taken off a run has its sequence cleared'
);

update public.orders set run_id = 'd0000000-0000-0000-0000-000000000010' where id = 'd0000000-0000-0000-0000-000000000023';

select is(
  (select run_sequence from public.orders where id = 'd0000000-0000-0000-0000-000000000023'),
  3,
  'an order put back on a run lands at the end again'
);

-- ---------------------------------------------------------------------------
-- 3. dispatch_reorder_run: a seller can rewrite the route order.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'd0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.dispatch_reorder_run(
       'd0000000-0000-0000-0000-000000000010',
       array[
         'd0000000-0000-0000-0000-000000000023',
         'd0000000-0000-0000-0000-000000000021',
         'd0000000-0000-0000-0000-000000000022'
       ]::uuid[]
     ) $$,
  'seller can reorder a planned run'
);

reset role;

select results_eq(
  $$ select id from public.orders where run_id = 'd0000000-0000-0000-0000-000000000010' order by run_sequence $$,
  $$ values
      ('d0000000-0000-0000-0000-000000000023'::uuid),
      ('d0000000-0000-0000-0000-000000000021'::uuid),
      ('d0000000-0000-0000-0000-000000000022'::uuid) $$,
  'the run reads back in the order the dispatcher set'
);

select results_eq(
  $$ select array_agg(run_sequence order by run_sequence) from public.orders where run_id = 'd0000000-0000-0000-0000-000000000010' $$,
  $$ values (array[1, 2, 3]) $$,
  'sequences stay dense and 1-based after a reorder'
);

-- ---------------------------------------------------------------------------
-- 4. A stale list (one order missing) is refused outright.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'd0000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.dispatch_reorder_run(
       'd0000000-0000-0000-0000-000000000010',
       array[
         'd0000000-0000-0000-0000-000000000021',
         'd0000000-0000-0000-0000-000000000022'
       ]::uuid[]
     ) $$,
  'P0001',
  'invalid_order_set',
  'a list missing one of the run''s orders is refused'
);

-- ---------------------------------------------------------------------------
-- 5. A completed run is history and cannot be reordered.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.dispatch_reorder_run('d0000000-0000-0000-0000-000000000011', array[]::uuid[]) $$,
  'P0001',
  'run_completed',
  'a completed run cannot be reordered'
);

reset role;

-- ---------------------------------------------------------------------------
-- 6. Callers without a role in the org are refused.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'd0000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.dispatch_reorder_run(
       'd0000000-0000-0000-0000-000000000010',
       array[
         'd0000000-0000-0000-0000-000000000021',
         'd0000000-0000-0000-0000-000000000022',
         'd0000000-0000-0000-0000-000000000023'
       ]::uuid[]
     ) $$,
  'P0001',
  'forbidden',
  'a non-member cannot reorder a run'
);

select throws_ok(
  $$ select public.dispatch_reorder_run('d0000000-0000-0000-0000-0000000000ff', array[]::uuid[]) $$,
  'P0001',
  'not_found',
  'reordering a run that does not exist raises not_found'
);

reset role;

select * from finish();
rollback;
