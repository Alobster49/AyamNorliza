-- supabase/tests/rls/15_driver_write_path.sql
-- Coverage for 20260821000003_driver_write_path.sql: what the driver records
-- at the door, and who is allowed to record it.
--
-- The three things worth pinning down: a driver can only write against their
-- own run, a delivery moves the order and leaves proof behind, and a failure
-- records why without quietly cancelling an order the customer is still owed.

begin;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('f0000000-0000-0000-0000-00000000000a', 'driver-write-test-org', 'Driver Write Test Org')
on conflict (id) do nothing;

-- 001 owner, 002 driver of run A, 003 driver of nothing.
insert into auth.users (id)
values
  ('f0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 'driver', 'active'),
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000003', 'driver', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-00000000000a', 'Hotel Concorde', '0123456789', 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values ('f0000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-00000000000a', 'Shah Alam', true, 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-00000000000a', 'Lori 1', 'TRK-DW1', 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.categories (id, organization_id, name, created_by)
values ('f0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000000a', 'Chicken', 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, created_by)
values ('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 'Whole Chicken', 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.product_variants (id, organization_id, product_id, name, created_by)
values ('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'Per kg', 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('f0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000007', 1, '09:00', '12:00', 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- Run A has departed and belongs to driver 002. Run B is still in the yard.
insert into public.delivery_runs (id, organization_id, truck_id, run_date, status, driver_id)
values
  ('f0000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000007', current_date + 1, 'departed', 'f0000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000007', current_date + 2, 'planned', 'f0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- 021 and 022 are on the departed run; 023 sits on the run still in the yard.
insert into public.orders (id, organization_id, customer_id, created_by, source, status, zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id, assignment_source, total_amount)
values
  ('f0000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'f0000000-0000-0000-0000-000000000006', '1 Door Street', current_date + 1, 'f0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000010', 'manual', 486.00),
  ('f0000000-0000-0000-0000-000000000022', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'f0000000-0000-0000-0000-000000000006', '2 Door Street', current_date + 1, 'f0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000010', 'manual', 264.00),
  ('f0000000-0000-0000-0000-000000000023', 'f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', 'manual', 'ready', 'f0000000-0000-0000-0000-000000000006', '3 Door Street', current_date + 2, 'f0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000011', 'manual', 100.00)
on conflict (id) do nothing;

-- Order items for test orders (needed for driver_deliver_stop weight validation)
insert into public.order_items (id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg, fallback, price_per_kg)
values
  ('f0000000-0000-0000-0000-000000000041', 'f0000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000001', 'kg', 20, 1.0, 2.0, 'mix', 24.30),
  ('f0000000-0000-0000-0000-000000000042', 'f0000000-0000-0000-0000-000000000022', 'f0000000-0000-0000-0000-000000000001', 'kg', 11, 1.0, 2.0, 'mix', 24.00)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Arrive: the driver of the run may record it, and doing it twice is a no-op.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.driver_arrive_stop('f0000000-0000-0000-0000-000000000021') $$,
  'the run''s driver can record arriving at a stop'
);

select lives_ok(
  $$ select public.driver_arrive_stop('f0000000-0000-0000-0000-000000000021') $$,
  'arriving twice does not raise -- a double tap or a replayed offline write is harmless'
);

reset role;

select results_eq(
  $$ select count(*)::int from public.run_stop_events
     where order_id = 'f0000000-0000-0000-0000-000000000021' and kind = 'arrive' $$,
  $$ values (1) $$,
  'the second arrive did not write a second event'
);

-- ---------------------------------------------------------------------------
-- 2. A run still in the yard has no stops to arrive at.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ select public.driver_arrive_stop('f0000000-0000-0000-0000-000000000023') $$,
  'P0001',
  'run_not_departed',
  'a stop on a run that has not left the yard cannot be arrived at'
);

-- ---------------------------------------------------------------------------
-- 3. Deliver: leave mark, proof, and the order moves.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.driver_deliver_stop(
       'f0000000-0000-0000-0000-000000000021',
       'Chef Rizal',
       null,
       'f0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000010/pod.jpg',
       486.00,
       '[{"item_id": "f0000000-0000-0000-0000-000000000041", "final_weight_kg": 20, "final_pieces": null}]'::jsonb
     ) $$,
  'the driver can deliver a stop with proof of delivery'
);

reset role;

select results_eq(
  $$ select status::text from public.orders where id = 'f0000000-0000-0000-0000-000000000021' $$,
  $$ values ('delivered') $$,
  'delivering a stop moves the order to delivered'
);

select results_eq(
  $$ select outcome::text, received_by, cash_collected
     from public.delivery_attempts where order_id = 'f0000000-0000-0000-0000-000000000021' $$,
  $$ values ('delivered', 'Chef Rizal', 486.00::numeric) $$,
  'the attempt carries the receiver and the cash collected'
);

select results_eq(
  $$ select count(*)::int from public.run_stop_events
     where order_id = 'f0000000-0000-0000-0000-000000000021' and kind = 'leave' $$,
  $$ values (1) $$,
  'delivering writes the leave mark that closes the dwell window'
);

-- ---------------------------------------------------------------------------
-- 4. Delivering an already-delivered stop is a no-op, not an error.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.driver_deliver_stop('f0000000-0000-0000-0000-000000000021') $$,
  'a replayed delivery for an already-delivered stop does not raise'
);

reset role;

select results_eq(
  $$ select count(*)::int from public.delivery_attempts
     where order_id = 'f0000000-0000-0000-0000-000000000021' $$,
  $$ values (1) $$,
  'the replayed delivery did not write a second attempt'
);

-- ---------------------------------------------------------------------------
-- 5. Fail: records the reason, leaves the order owed to the customer.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.driver_fail_stop(
       'f0000000-0000-0000-0000-000000000022',
       'shop_closed',
       'retry_today',
       'Gate locked, guard said back at 3pm'
     ) $$,
  'the driver can report a failed stop with a reason and a next action'
);

reset role;

select results_eq(
  $$ select outcome::text, reason::text, next_action::text
     from public.delivery_attempts where order_id = 'f0000000-0000-0000-0000-000000000022' $$,
  $$ values ('failed', 'shop_closed', 'retry_today') $$,
  'the failure reason and next action are recorded'
);

select results_eq(
  $$ select status::text from public.orders where id = 'f0000000-0000-0000-0000-000000000022' $$,
  $$ values ('ready') $$,
  'a failed stop does not cancel the order -- it is still owed to the customer'
);

-- ---------------------------------------------------------------------------
-- 6. A driver cannot record against somebody else's run.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.driver_arrive_stop('f0000000-0000-0000-0000-000000000022') $$,
  'P0001',
  'forbidden',
  'a driver who is not on this run cannot record at its stops'
);

reset role;

select * from finish();
rollback;
