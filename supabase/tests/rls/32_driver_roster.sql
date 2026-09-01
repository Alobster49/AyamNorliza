-- supabase/tests/rls/32_driver_roster.sql
-- Coverage for 20260903000001_driver_roster.sql: who can read/write truck
-- covers, what the triggers refuse, and what the leave_roster view exposes.

begin;

select plan(16);

-- Fixtures (postgres bypasses RLS). 00a org; 001 owner, 002 seller, 003 hr,
-- 004 driver A (regular on truck 008), 005 driver B (cover pool), 006 driver
-- in ANOTHER org, 007 inventory worker.
insert into public.organizations (id, slug, name)
values
  ('f0000000-0000-0000-0000-00000000000a', 'roster-test-org', 'Roster Test Org'),
  ('f0000000-0000-0000-0000-00000000000b', 'roster-other-org', 'Roster Other Org')
on conflict (id) do nothing;

insert into auth.users (id)
values
  ('f0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000003'),
  ('f0000000-0000-0000-0000-000000000004'),
  ('f0000000-0000-0000-0000-000000000005'),
  ('f0000000-0000-0000-0000-000000000006'),
  ('f0000000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 'seller', 'active'),
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000003', 'hr', 'active'),
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 'driver', 'active'),
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000005', 'driver', 'active'),
  ('f0000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-000000000006', 'driver', 'active'),
  ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000007', 'inventory', 'active')
on conflict (organization_id, user_id) do nothing;

-- NOTE: the brief's literal fixture had a malformed UUID here
-- ('f0000000-0000-0000-0000-000000000a', 10 hex chars in the last group
-- instead of 12) for truck 009's organization_id. Fixed to the same org id
-- used everywhere else in this file.
insert into public.trucks (id, organization_id, name, code, created_by)
values
  ('f0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-00000000000a', 'Lori 1', 'TRK-RS1', 'f0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-00000000000a', 'Lori 2', 'TRK-RS2', 'f0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- Weekday-safe anchor dates for the leave fixtures below. The brief used
-- literal `current_date + 3` / `current_date + 5`, but leave_requests'
-- before-insert trigger (20260830000004_hr_leave_notice.sql) recomputes
-- day_count via leave_workday_count, which excludes weekends -- on some days
-- of the week `current_date + 5` lands on a Sunday, making day_count = 0 and
-- rejecting the fixture insert with 'validation' before the test even runs.
-- leave1 is the first workday on/after D+3; leave2 is the first workday at
-- least two days after leave1 (keeps leave2 > leave1 for the ordering
-- assertion below, regardless of which weekday "today" is).
create temporary table _roster_test_dates as
with l1 as (
  select min(d)::date as d
  from generate_series(current_date + 3, current_date + 10, interval '1 day') d
  where extract(isodow from d) < 6
)
select l1.d as leave1,
       (select min(d)::date from generate_series(l1.d + 2, l1.d + 10, interval '1 day') d
        where extract(isodow from d) < 6) as leave2
from l1;

-- The seller's throws_ok statement below runs as `authenticated`, not the
-- postgres superuser that created this table, so it needs an explicit grant.
grant select on _roster_test_dates to authenticated;

-- Driver A is on approved leave on leave1; a pending request on leave2. The
-- type is Medical, not Annual: annual leave carries a 7-day advance-notice
-- trigger (20260830000004_hr_leave_notice.sql) that would reject a
-- short-notice date.
-- NOTE: the brief's literal insert omitted `code`, which is `not null` with
-- no default on leave_types -- added 'medical' here.
insert into public.leave_types (id, organization_id, code, name, entitlement_days, accrual)
values ('f0000000-0000-0000-0000-000000000020', 'f0000000-0000-0000-0000-00000000000a', 'medical', 'Medical', 14, 'full')
on conflict (id) do nothing;

insert into public.leave_requests (id, organization_id, user_id, leave_type_id, year, start_date, end_date, day_count, justification, status)
select 'f0000000-0000-0000-0000-000000000021'::uuid, 'f0000000-0000-0000-0000-00000000000a'::uuid, 'f0000000-0000-0000-0000-000000000004'::uuid, 'f0000000-0000-0000-0000-000000000020'::uuid, extract(year from d.leave1)::int, d.leave1, d.leave1, 1, 'approved one', 'approved'
from _roster_test_dates d
union all
select 'f0000000-0000-0000-0000-000000000022'::uuid, 'f0000000-0000-0000-0000-00000000000a'::uuid, 'f0000000-0000-0000-0000-000000000004'::uuid, 'f0000000-0000-0000-0000-000000000020'::uuid, extract(year from d.leave2)::int, d.leave2, d.leave2, 1, 'pending one', 'pending'
from _roster_test_dates d
on conflict (id) do nothing;

-- 1. Owner can set a regular driver who is a driver-role member of the org.
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ update public.trucks set regular_driver_id = 'f0000000-0000-0000-0000-000000000004'
     where id = 'f0000000-0000-0000-0000-000000000008' $$,
  'owner sets a driver-role member as regular driver'
);

select throws_ok(
  $$ update public.trucks set regular_driver_id = 'f0000000-0000-0000-0000-000000000007'
     where id = 'f0000000-0000-0000-0000-000000000008' $$,
  'P0001', 'driver_not_member',
  'a non-driver member cannot be a regular driver'
);

select throws_ok(
  $$ update public.trucks set regular_driver_id = 'f0000000-0000-0000-0000-000000000006'
     where id = 'f0000000-0000-0000-0000-000000000008' $$,
  'P0001', 'driver_not_member',
  'a driver from another org cannot be a regular driver'
);

select throws_ok(
  $$ insert into public.trucks (organization_id, name, code, regular_driver_id, created_by)
     values ('f0000000-0000-0000-0000-00000000000a', 'Lori 3', 'TRK-RS3', 'f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'driver_not_member',
  'inserting a truck with a non-driver regular driver is refused'
);

reset role;

-- 2. Seller (driver_roster:edit) assigns a cover; triggers refuse leave and double booking.
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ insert into public.truck_covers (organization_id, truck_id, cover_date, driver_id, created_by)
     values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000008', current_date + 3, 'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000002') $$,
  'seller assigns a free driver as cover'
);

select lives_ok(
  $$ update public.truck_covers set truck_id = 'f0000000-0000-0000-0000-000000000009'
     where truck_id = 'f0000000-0000-0000-0000-000000000008' and cover_date = current_date + 3 $$,
  'moving an existing cover to another truck does not collide with itself'
);
-- move it back so the later double-booking assertion still holds
update public.truck_covers set truck_id = 'f0000000-0000-0000-0000-000000000008'
  where truck_id = 'f0000000-0000-0000-0000-000000000009' and cover_date = current_date + 3;

select throws_ok(
  $$ insert into public.truck_covers (organization_id, truck_id, cover_date, driver_id, created_by)
     values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000009',
             (select leave1 from _roster_test_dates), 'f0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'driver_on_leave',
  'a driver on approved leave cannot be assigned as cover'
);

select throws_ok(
  $$ insert into public.truck_covers (organization_id, truck_id, cover_date, driver_id, created_by)
     values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000009', current_date + 3, 'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'driver_double_booked',
  'a driver already covering another truck that day cannot be booked twice'
);

select throws_ok(
  $$ insert into public.truck_covers (organization_id, truck_id, cover_date, driver_id, created_by)
     values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000009', current_date + 4, 'f0000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'driver_not_member',
  'a driver from another org cannot be cover'
);

select results_eq(
  $$ select status from public.leave_roster
     where organization_id = 'f0000000-0000-0000-0000-00000000000a'
       and user_id = 'f0000000-0000-0000-0000-000000000004'
     order by start_date $$,
  $$ values ('approved'::text), ('pending'::text) $$,
  'leave_roster exposes approved and pending rows to a roster viewer'
);

reset role;

-- 3. HR reads covers (driver_roster:view) but cannot write.
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000003';

select results_eq(
  $$ select count(*)::int from public.truck_covers where organization_id = 'f0000000-0000-0000-0000-00000000000a' $$,
  $$ values (1) $$,
  'hr reads truck covers'
);

select throws_ok(
  $$ insert into public.truck_covers (organization_id, truck_id, cover_date, driver_id, created_by)
     values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000009', current_date + 6, 'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000003') $$,
  '42501', null,
  'hr cannot write truck covers'
);

reset role;

-- 4. A driver sees no covers and no leave_roster rows.
set local role authenticated;
set local "request.jwt.claim.sub" to 'f0000000-0000-0000-0000-000000000005';

select is_empty(
  $$ select id from public.truck_covers where organization_id = 'f0000000-0000-0000-0000-00000000000a' $$,
  'a driver sees no truck covers'
);

select is_empty(
  $$ select user_id from public.leave_roster where organization_id = 'f0000000-0000-0000-0000-00000000000a' $$,
  'a driver sees no leave_roster rows'
);

reset role;

-- 5. A run created for a covered day inherits the cover; a plain day inherits
-- the regular driver. current_date + 3 already carries the truck-008 cover
-- assigned to driver 005 in section 2 above. The ordinary day is leave2 + 10,
-- well clear of driver 004's leave1/leave2 dates and of any truck_covers row.
select results_eq(
  $$ insert into public.delivery_runs (organization_id, truck_id, run_date)
     values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000008', current_date + 3)
     returning driver_id $$,
  $$ values ('f0000000-0000-0000-0000-000000000005'::uuid) $$,
  'a new run on a covered day gets the cover driver'
);

select results_eq(
  $$ insert into public.delivery_runs (organization_id, truck_id, run_date)
     values ('f0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000008',
             (select leave2 + 10 from _roster_test_dates))
     returning driver_id $$,
  $$ values ('f0000000-0000-0000-0000-000000000004'::uuid) $$,
  'a new run on an ordinary day gets the regular driver'
);

select * from finish();
rollback;
