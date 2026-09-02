-- supabase/tests/rls/34_depart_driver_gate.sql
-- Departure gate on the driver roster: a truck whose planned driver is on
-- approved leave must not be able to leave the yard. `planned` follows the
-- roster's own precedence (cover ?? run driver ?? regular driver), so an
-- assigned cover clears the gate even when the regular driver is away.
--
-- The gate deliberately does NOT fire when a truck has no driver at all:
-- an org that has not filled in the roster yet still has to be able to
-- dispatch, and the dispatch/loading boards already warn about that case in
-- red. Blocking it here would strand every truck of an unconfigured org.

begin;

select plan(8);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, bypasses RLS/grants)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('d4000000-0000-0000-0000-00000000000a', 'depart-driver-gate-org', 'Depart Driver Gate Org')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('d4000000-0000-0000-0000-000000000001'), -- seller (departs trucks)
  ('d4000000-0000-0000-0000-000000000002'), -- driver A: regular driver, on approved leave
  ('d4000000-0000-0000-0000-000000000003'), -- driver B: the cover
  ('d4000000-0000-0000-0000-000000000004')  -- driver C: regular driver, leave only pending
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('d4000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-000000000001', 'seller', 'active'),
  ('d4000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-000000000002', 'driver', 'active'),
  ('d4000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-000000000003', 'driver', 'active'),
  ('d4000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-000000000004', 'driver', 'active')
on conflict (organization_id, user_id) do nothing;

-- Four trucks, one per scenario. T4 deliberately has no regular driver.
insert into public.trucks (id, organization_id, name, code, regular_driver_id, created_by)
values
  ('d4000000-0000-0000-0000-000000000010', 'd4000000-0000-0000-0000-00000000000a', 'Gate 1', 'GATE-1', 'd4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000001'),
  ('d4000000-0000-0000-0000-000000000011', 'd4000000-0000-0000-0000-00000000000a', 'Gate 2', 'GATE-2', 'd4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000001'),
  ('d4000000-0000-0000-0000-000000000012', 'd4000000-0000-0000-0000-00000000000a', 'Gate 3', 'GATE-3', 'd4000000-0000-0000-0000-000000000004', 'd4000000-0000-0000-0000-000000000001'),
  ('d4000000-0000-0000-0000-000000000013', 'd4000000-0000-0000-0000-00000000000a', 'Gate 4', 'GATE-4', null, 'd4000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- A weekday anchor: leave_requests' before-insert trigger recomputes
-- day_count via leave_workday_count, which excludes weekends -- a fixture
-- landing on a Sunday would be rejected with 'validation' (same trap as
-- 32_driver_roster.sql).
create temporary table _gate_dates as
select min(d)::date as run_day
from generate_series(current_date + 1, current_date + 8, interval '1 day') d
where extract(isodow from d) < 6;

grant select on _gate_dates to authenticated;

insert into public.leave_types (id, organization_id, code, name, entitlement_days, accrual)
values ('d4000000-0000-0000-0000-000000000020', 'd4000000-0000-0000-0000-00000000000a', 'medical', 'Medical', 14, 'full')
on conflict (id) do nothing;

-- Driver A is away (approved) on the run day; driver C only has a pending
-- request, which the roster treats as "still expected" -- so must not gate.
insert into public.leave_requests (id, organization_id, user_id, leave_type_id, year, start_date, end_date, day_count, justification, status)
select 'd4000000-0000-0000-0000-000000000021'::uuid, 'd4000000-0000-0000-0000-00000000000a'::uuid, 'd4000000-0000-0000-0000-000000000002'::uuid, 'd4000000-0000-0000-0000-000000000020'::uuid, extract(year from d.run_day)::int, d.run_day, d.run_day, 1, 'driver A away', 'approved'
from _gate_dates d
union all
select 'd4000000-0000-0000-0000-000000000022'::uuid, 'd4000000-0000-0000-0000-00000000000a'::uuid, 'd4000000-0000-0000-0000-000000000004'::uuid, 'd4000000-0000-0000-0000-000000000020'::uuid, extract(year from d.run_day)::int, d.run_day, d.run_day, 1, 'driver C maybe away', 'pending'
from _gate_dates d
on conflict (id) do nothing;

-- Truck 2 has a cover: driver B takes it even though the regular is away.
insert into public.truck_covers (organization_id, truck_id, cover_date, driver_id, created_by)
select 'd4000000-0000-0000-0000-00000000000a'::uuid, 'd4000000-0000-0000-0000-000000000011'::uuid, d.run_day, 'd4000000-0000-0000-0000-000000000003'::uuid, 'd4000000-0000-0000-0000-000000000001'::uuid
from _gate_dates d
on conflict (truck_id, cover_date) do nothing;

-- One planned run per truck. No orders: the loading gate (20260828000002)
-- only looks at 'ready' orders, so an empty run isolates the driver rule.
insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
select ('d4000000-0000-0000-0000-00000000003' || n)::uuid, 'd4000000-0000-0000-0000-00000000000a'::uuid,
       ('d4000000-0000-0000-0000-00000000001' || n)::uuid, d.run_day, 'planned'::public.delivery_run_status
from _gate_dates d, generate_series(0, 3) n
on conflict (truck_id, run_date) do nothing;

-- ---------------------------------------------------------------------------
-- 1. dispatch_depart_truck refuses while the planned driver is on leave.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'd4000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.dispatch_depart_truck('d4000000-0000-0000-0000-000000000010', (select run_day from _gate_dates)) $$,
  'P0001',
  'driver_on_leave',
  'dispatch_depart_truck refuses when the regular driver is on approved leave'
);

-- ---------------------------------------------------------------------------
-- 2. set_run_status is the other way out of the yard -- same gate.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.set_run_status('d4000000-0000-0000-0000-000000000030'::uuid, 'departed'::public.delivery_run_status) $$,
  'P0001',
  'driver_on_leave',
  'set_run_status(departed) refuses when the regular driver is on approved leave'
);

-- ---------------------------------------------------------------------------
-- 3. An assigned cover clears the gate.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.dispatch_depart_truck('d4000000-0000-0000-0000-000000000011', (select run_day from _gate_dates)) $$,
  'a cover driver lets the truck depart even though the regular driver is away'
);

-- ---------------------------------------------------------------------------
-- 4. Pending leave is not an absence -- the office can still send them out.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.dispatch_depart_truck('d4000000-0000-0000-0000-000000000012', (select run_day from _gate_dates)) $$,
  'pending leave does not gate departure'
);

-- ---------------------------------------------------------------------------
-- 5. A truck with no driver at all still departs: an org that has not set up
-- the roster must not be stranded (the boards warn about this in red).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.dispatch_depart_truck('d4000000-0000-0000-0000-000000000013', (select run_day from _gate_dates)) $$,
  'a truck with no driver assigned is not blocked from departing'
);

reset role;

select results_eq(
  $$ select status::text from public.delivery_runs where id = 'd4000000-0000-0000-0000-000000000030' $$,
  $$ values ('planned'::text) $$,
  'the gated run is still planned'
);

select results_eq(
  $$ select status::text from public.delivery_runs where id = 'd4000000-0000-0000-0000-000000000031' $$,
  $$ values ('departed'::text) $$,
  'the covered run departed'
);

select results_eq(
  $$ select status::text from public.delivery_runs where id = 'd4000000-0000-0000-0000-000000000033' $$,
  $$ values ('departed'::text) $$,
  'the driverless run departed'
);

select * from finish();

rollback;
