-- supabase/tests/rls/25_driver_finish_run.sql
-- Coverage for 20260827000001_driver_finish_run.sql.
--
-- The driver closes their own run from the truck. Two things must hold that
-- the office's set_run_status does differently:
--   * a driver, not just the office, is allowed to do it;
--   * a stop the driver never attempted is NOT swept to 'delivered'. It is
--     released back to the pool so the office re-plans it, because a driver
--     saying "I am done" is not the same as "everything went out".

begin;

select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('fa000000-0000-0000-0000-00000000000a', 'driver-finish-test-org', 'Driver Finish Test Org')
on conflict (id) do nothing;

-- 001 owner, 002 driver of the run, 003 a driver of some other run.
insert into auth.users (id)
values
  ('fa000000-0000-0000-0000-000000000001'),
  ('fa000000-0000-0000-0000-000000000002'),
  ('fa000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000002', 'driver', 'active'),
  ('fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000003', 'driver', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('fa000000-0000-0000-0000-000000000005', 'fa000000-0000-0000-0000-00000000000a', 'Warung Pak Din', '0123456789', 'fa000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values ('fa000000-0000-0000-0000-000000000006', 'fa000000-0000-0000-0000-00000000000a', 'Klang', true, 'fa000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('fa000000-0000-0000-0000-000000000007', 'fa000000-0000-0000-0000-00000000000a', 'Lori 10', 'TRK-DF10', 'fa000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.categories (id, organization_id, name, created_by)
values ('fa000000-0000-0000-0000-000000000004', 'fa000000-0000-0000-0000-00000000000a', 'Chicken', 'fa000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, created_by)
values ('fa000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000004', 'Whole Chicken', 'fa000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('fa000000-0000-0000-0000-000000000008', 'fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000007', 1, '09:00', '12:00', 'fa000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_runs (id, organization_id, truck_id, run_date, status, driver_id)
values ('fa000000-0000-0000-0000-000000000010', 'fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000007', current_date + 1, 'departed', 'fa000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- 021 is delivered at the door, 022 is never attempted, 023 is cancelled.
insert into public.orders (id, organization_id, customer_id, created_by, source, status, zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id, assignment_source, total_amount, loaded_at, loaded_by)
values
  ('fa000000-0000-0000-0000-000000000021', 'fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000005', 'fa000000-0000-0000-0000-000000000001', 'manual', 'ready', 'fa000000-0000-0000-0000-000000000006', '1 Jalan Satu', current_date + 1, 'fa000000-0000-0000-0000-000000000008', 'fa000000-0000-0000-0000-000000000007', 'fa000000-0000-0000-0000-000000000010', 'manual', 0, now(), 'fa000000-0000-0000-0000-000000000001'),
  ('fa000000-0000-0000-0000-000000000022', 'fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000005', 'fa000000-0000-0000-0000-000000000001', 'manual', 'ready', 'fa000000-0000-0000-0000-000000000006', '2 Jalan Dua', current_date + 1, 'fa000000-0000-0000-0000-000000000008', 'fa000000-0000-0000-0000-000000000007', 'fa000000-0000-0000-0000-000000000010', 'manual', 0, now(), 'fa000000-0000-0000-0000-000000000001'),
  ('fa000000-0000-0000-0000-000000000023', 'fa000000-0000-0000-0000-00000000000a', 'fa000000-0000-0000-0000-000000000005', 'fa000000-0000-0000-0000-000000000001', 'manual', 'cancelled', 'fa000000-0000-0000-0000-000000000006', '3 Jalan Tiga', current_date + 1, 'fa000000-0000-0000-0000-000000000008', 'fa000000-0000-0000-0000-000000000007', 'fa000000-0000-0000-0000-000000000010', 'manual', 0, now(), 'fa000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.order_items (id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg, fallback, price_per_kg)
values
  ('fa000000-0000-0000-0000-000000000031', 'fa000000-0000-0000-0000-000000000021', 'fa000000-0000-0000-0000-000000000001', 'kg', 11, 1.0, 2.0, 'mix', 24.00)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A driver who is not on this run cannot close it.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'fa000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.driver_finish_run('fa000000-0000-0000-0000-000000000010') $$,
  'forbidden',
  'a driver who is not on the run cannot close it'
);

-- ---------------------------------------------------------------------------
-- The run's own driver delivers one stop, then closes the run.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to 'fa000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.driver_deliver_stop(
       'fa000000-0000-0000-0000-000000000021',
       'Pak Din',
       null,
       null,
       null,
       '[{"item_id": "fa000000-0000-0000-0000-000000000031", "final_weight_kg": 11, "final_pieces": null}]'::jsonb
     ) $$,
  'the driver can record a delivered stop'
);

select lives_ok(
  $$ select public.driver_finish_run('fa000000-0000-0000-0000-000000000010') $$,
  'the run driver can close their own run'
);

select throws_ok(
  $$ select public.driver_finish_run('fa000000-0000-0000-0000-000000000010') $$,
  'invalid_transition',
  'closing an already-closed run is rejected'
);

reset role;

select is(
  (select status::text from public.delivery_runs where id = 'fa000000-0000-0000-0000-000000000010'),
  'completed',
  'the run is completed'
);

select is(
  (select status::text from public.orders where id = 'fa000000-0000-0000-0000-000000000021'),
  'closed',
  'the stop the driver settled at the door stays closed'
);

select is(
  (select status::text from public.orders where id = 'fa000000-0000-0000-0000-000000000022'),
  'ready',
  'an unattempted stop is NOT swept to delivered by the driver close'
);

select is(
  (select run_id from public.orders where id = 'fa000000-0000-0000-0000-000000000022'),
  null::uuid,
  'an unattempted stop comes off the run so the office can re-plan it'
);

select is(
  (select run_id from public.orders where id = 'fa000000-0000-0000-0000-000000000023'),
  'fa000000-0000-0000-0000-000000000010'::uuid,
  'a cancelled stop stays attached -- there is nothing to re-plan'
);

select * from finish();
rollback;
