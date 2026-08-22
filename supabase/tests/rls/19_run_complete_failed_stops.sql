-- supabase/tests/rls/19_run_complete_failed_stops.sql
-- Coverage for 20260823000003_run_complete_skips_failed_stops.sql.
--
-- Completing a run used to sweep every remaining 'ready' order to
-- 'delivered', including the stops the driver had just recorded as failed.
-- The customer never got the goods but the system said they did. A failed
-- stop must survive the sweep: it stays 'ready' and comes off the run so it
-- can be dispatched again.

begin;

select plan(8);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('f9000000-0000-0000-0000-00000000000a', 'run-complete-test-org', 'Run Complete Test Org')
on conflict (id) do nothing;

-- 001 owner, 002 driver of the run.
insert into auth.users (id)
values
  ('f9000000-0000-0000-0000-000000000001'),
  ('f9000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000002', 'driver', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('f9000000-0000-0000-0000-000000000005', 'f9000000-0000-0000-0000-00000000000a', 'Warung Pak Din', '0123456789', 'f9000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values ('f9000000-0000-0000-0000-000000000006', 'f9000000-0000-0000-0000-00000000000a', 'Klang', true, 'f9000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('f9000000-0000-0000-0000-000000000007', 'f9000000-0000-0000-0000-00000000000a', 'Lori 9', 'TRK-RC9', 'f9000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('f9000000-0000-0000-0000-000000000008', 'f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000007', 1, '09:00', '12:00', 'f9000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_runs (id, organization_id, truck_id, run_date, status, driver_id)
values ('f9000000-0000-0000-0000-000000000010', 'f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000007', current_date + 1, 'departed', 'f9000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- 021 will be failed at the door, 022 is delivered normally, 023 is never
-- attempted at all (the office closes the run on top of it).
insert into public.orders (id, organization_id, customer_id, created_by, source, status, zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id, assignment_source, total_amount, loaded_at, loaded_by)
values
  ('f9000000-0000-0000-0000-000000000021', 'f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000005', 'f9000000-0000-0000-0000-000000000001', 'manual', 'ready', 'f9000000-0000-0000-0000-000000000006', '1 Jalan Satu', current_date + 1, 'f9000000-0000-0000-0000-000000000008', 'f9000000-0000-0000-0000-000000000007', 'f9000000-0000-0000-0000-000000000010', 'manual', 0, now(), 'f9000000-0000-0000-0000-000000000001'),
  ('f9000000-0000-0000-0000-000000000022', 'f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000005', 'f9000000-0000-0000-0000-000000000001', 'manual', 'ready', 'f9000000-0000-0000-0000-000000000006', '2 Jalan Dua', current_date + 1, 'f9000000-0000-0000-0000-000000000008', 'f9000000-0000-0000-0000-000000000007', 'f9000000-0000-0000-0000-000000000010', 'manual', 0, now(), 'f9000000-0000-0000-0000-000000000001'),
  ('f9000000-0000-0000-0000-000000000023', 'f9000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-000000000005', 'f9000000-0000-0000-0000-000000000001', 'manual', 'ready', 'f9000000-0000-0000-0000-000000000006', '3 Jalan Tiga', current_date + 1, 'f9000000-0000-0000-0000-000000000008', 'f9000000-0000-0000-0000-000000000007', 'f9000000-0000-0000-0000-000000000010', 'manual', 0, now(), 'f9000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The driver fails stop 021 and delivers stop 022.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'f9000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.driver_fail_stop('f9000000-0000-0000-0000-000000000021', 'shop_closed', 'move_tomorrow') $$,
  'the driver can record a failed stop'
);

select lives_ok(
  $$ select public.driver_deliver_stop('f9000000-0000-0000-0000-000000000022', 'Pak Din') $$,
  'the driver can record a delivered stop'
);

-- ---------------------------------------------------------------------------
-- The office completes the run at the end of the day.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to 'f9000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.set_run_status('f9000000-0000-0000-0000-000000000010', 'completed') $$,
  'the owner can complete the run'
);

reset role;

select is(
  (select status::text from public.orders where id = 'f9000000-0000-0000-0000-000000000021'),
  'ready',
  'a failed stop is NOT swept to delivered when the run completes'
);

select is(
  (select run_id from public.orders where id = 'f9000000-0000-0000-0000-000000000021'),
  null::uuid,
  'a failed stop comes off the completed run so it can be dispatched again'
);

select is(
  (select loaded_at from public.orders where id = 'f9000000-0000-0000-0000-000000000021'),
  null::timestamptz,
  'a failed stop loses its load mark when it comes off the run'
);

select is(
  (select status::text from public.orders where id = 'f9000000-0000-0000-0000-000000000022'),
  'delivered',
  'a stop the driver actually delivered stays delivered'
);

select is(
  (select status::text from public.orders where id = 'f9000000-0000-0000-0000-000000000023'),
  'delivered',
  'an unattempted stop is still swept to delivered by the office close'
);

select * from finish();
rollback;
