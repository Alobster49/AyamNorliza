-- supabase/tests/rls/33_realworld_seed_week.sql
-- Coverage for 20260903000003_realworld_seed_week.sql: the real-world seed
-- writes a week (D-3..D+3), six driver scenarios, and is idempotent.
--
-- Weekday arithmetic mirrors the seed: a "workday" is Mon-Fri and not a
-- public holiday of the org (new orgs get the Malaysian calendar from the
-- organizations_seed_holidays trigger).

begin;

select plan(16);

-- Fixtures (postgres bypasses RLS). 00a org; 001 org_admin; 003/007/012/018/022
-- drivers for JHR-03/07/12/18/22; 031/032 cover-pool drivers.
insert into public.organizations (id, slug, name)
values ('ee000000-0000-0000-0000-00000000000a', 'rw-week-test-org', 'RW Week Test Org')
on conflict (id) do nothing;

insert into auth.users (id)
values
  ('ee000000-0000-0000-0000-000000000001'),
  ('ee000000-0000-0000-0000-000000000003'),
  ('ee000000-0000-0000-0000-000000000007'),
  ('ee000000-0000-0000-0000-000000000012'),
  ('ee000000-0000-0000-0000-000000000018'),
  ('ee000000-0000-0000-0000-000000000022'),
  ('ee000000-0000-0000-0000-000000000031'),
  ('ee000000-0000-0000-0000-000000000032')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000001', 'org_admin', 'active'),
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000003', 'driver', 'active'),
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000007', 'driver', 'active'),
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000012', 'driver', 'active'),
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000018', 'driver', 'active'),
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000022', 'driver', 'active'),
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000031', 'driver', 'active'),
  ('ee000000-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000032', 'driver', 'active')
on conflict (organization_id, user_id) do nothing;

-- Same "today" and workday calendar the seed uses.
create temporary table _rw_test_cal as
with days as (
  select d::date as day,
         (extract(isodow from d) < 6
          and not exists (select 1 from public.public_holidays h
                          where h.organization_id = 'ee000000-0000-0000-0000-00000000000a'
                            and h.holiday_date = d::date)) as workday
  from generate_series(
    (now() at time zone 'Asia/Kuala_Lumpur')::date - 10,
    (now() at time zone 'Asia/Kuala_Lumpur')::date + 21,
    interval '1 day') d
),
today as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as d)
select
  (select d from today) as today,
  (select day from days, today where workday and day >= today.d order by day offset 0 limit 1) as w0,
  (select day from days, today where workday and day >= today.d order by day offset 1 limit 1) as w1,
  (select day from days, today where workday and day >= today.d order by day offset 3 limit 1) as w3,
  (select day from days, today where workday and day >= today.d order by day offset 4 limit 1) as w4,
  (select max(day) from days, today where workday and day < today.d) as p1;
grant select on _rw_test_cal to authenticated;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- 1: org_admin seeds with a partial driver map (trucks without a key get no
-- regular driver; the function must cope).
select pg_temp.impersonate('ee000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.admin_seed_realworld_data(
       'ee000000-0000-0000-0000-00000000000a',
       '{"JHR-03":"ee000000-0000-0000-0000-000000000003",
         "JHR-07":"ee000000-0000-0000-0000-000000000007",
         "JHR-12":"ee000000-0000-0000-0000-000000000012",
         "JHR-18":"ee000000-0000-0000-0000-000000000018",
         "JHR-22":"ee000000-0000-0000-0000-000000000022",
         "pool":["ee000000-0000-0000-0000-000000000031","ee000000-0000-0000-0000-000000000032"]}'::jsonb) $$,
  'org_admin can seed the week');
select set_config('role', 'postgres', true);

-- 2-4: runs. 3 history days x 30 trucks, 30 today, 3 of today departed.
select is(
  (select count(*) from public.delivery_runs r, _rw_test_cal c
    where r.organization_id = 'ee000000-0000-0000-0000-00000000000a' and r.run_date < c.today and r.status = 'completed'),
  90::bigint, '90 completed history runs');
select is(
  (select count(*) from public.delivery_runs r, _rw_test_cal c
    where r.organization_id = 'ee000000-0000-0000-0000-00000000000a' and r.run_date = c.today),
  30::bigint, '30 runs today');
select is(
  (select count(*) from public.delivery_runs r, _rw_test_cal c
    where r.organization_id = 'ee000000-0000-0000-0000-00000000000a' and r.run_date = c.today and r.status = 'departed'),
  3::bigint, '3 runs already departed today');

-- 5: JHR-03's regular driver is on approved leave on W1 and nobody covers.
select ok(
  exists (select 1 from public.trucks t
           join public.leave_requests l on l.user_id = t.regular_driver_id
           cross join _rw_test_cal c
          where t.organization_id = 'ee000000-0000-0000-0000-00000000000a' and t.code = 'JHR-03'
            and l.status = 'approved' and c.w1 between l.start_date and l.end_date)
  and not exists (select 1 from public.truck_covers v
                   join public.trucks t on t.id = v.truck_id
                   cross join _rw_test_cal c
                  where t.code = 'JHR-03' and v.cover_date = c.w1),
  'JHR-03: approved leave on W1, no cover');

-- 6: JHR-07 is covered by pool driver 1 on W1 and W3.
select is(
  (select count(*) from public.truck_covers v
     join public.trucks t on t.id = v.truck_id
     cross join _rw_test_cal c
    where t.code = 'JHR-07' and v.driver_id = 'ee000000-0000-0000-0000-000000000031'
      and v.cover_date in (c.w1, c.w3)),
  2::bigint, 'JHR-07 covered by pool driver on W1 and W3');

-- 7: the P1 run of JHR-22 was driven by the pool driver (cover in history).
select is(
  (select r.driver_id from public.delivery_runs r
     join public.trucks t on t.id = r.truck_id
     cross join _rw_test_cal c
    where t.code = 'JHR-22' and r.run_date = c.p1),
  'ee000000-0000-0000-0000-000000000031'::uuid, 'JHR-22 run on P1 has the cover as driver');

-- 8: JHR-18 today: null driver on a workday (MC today), regular driver otherwise.
select ok(
  (select case when c.w0 = c.today then r.driver_id is null
               else r.driver_id = 'ee000000-0000-0000-0000-000000000018' end
     from public.delivery_runs r
     join public.trucks t on t.id = r.truck_id
     cross join _rw_test_cal c
    where t.code = 'JHR-18' and r.run_date = c.today),
  'JHR-18 today has no driver when today is a workday');

-- 9-10: history orders are closed with a delivered attempt.
select is(
  (select count(*) from public.orders o, _rw_test_cal c
    where o.organization_id = 'ee000000-0000-0000-0000-00000000000a'
      and o.delivery_date < c.today and o.status <> 'closed'),
  0::bigint, 'every history order is closed');
select is(
  (select count(*) from public.orders o
    where o.organization_id = 'ee000000-0000-0000-0000-00000000000a' and o.status = 'closed'
      and not exists (select 1 from public.delivery_attempts a
                       where a.order_id = o.id and a.outcome = 'delivered')),
  0::bigint, 'every closed order has a delivered attempt');

-- 11: today's departed runs (JHR-01/11/21) are each fully loaded with their
-- first 2 stops closed -- including a D-1 failed stop carried over to today.
select ok(
  (select count(*) = 3 and bool_and(sub.all_loaded and sub.closed_count = 2)
     from (
       select t.code,
              bool_and(o.loaded_at is not null) as all_loaded,
              count(*) filter (where o.status = 'closed') as closed_count
         from public.orders o
         join public.delivery_runs r on r.id = o.run_id
         join public.trucks t on t.id = r.truck_id
         cross join _rw_test_cal c
        where t.code in ('JHR-01', 'JHR-11', 'JHR-21') and r.run_date = c.today
        group by t.code
     ) sub),
  'JHR-01/11/21 today: all loaded, 2 closed each');

-- 12: no orders on the demo holiday; the holiday exists on W4.
select ok(
  exists (select 1 from public.public_holidays h, _rw_test_cal c
           where h.organization_id = 'ee000000-0000-0000-0000-00000000000a'
             and h.name = 'Cuti Umum (demo)' and h.holiday_date = c.w4)
  and not exists (select 1 from public.orders o, _rw_test_cal c
                   where o.organization_id = 'ee000000-0000-0000-0000-00000000000a'
                     and o.delivery_date = c.w4),
  'demo holiday on W4 and no orders that day');

-- 13: driver 012 has a pending annual request at least 7 days out.
select ok(
  exists (select 1 from public.leave_requests l
           join public.leave_types lt on lt.id = l.leave_type_id
           cross join _rw_test_cal c
          where l.user_id = 'ee000000-0000-0000-0000-000000000012'
            and l.status = 'pending' and lt.code = 'annual'
            and l.start_date >= c.today + 7),
  'driver 12: pending annual leave with notice');

-- 14: future days carry confirmed + pending orders and no run.
select ok(
  (select count(*) filter (where o.status = 'confirmed') > 0
      and count(*) filter (where o.status = 'pending') > 0
      and count(*) filter (where o.run_id is not null) = 0
     from public.orders o, _rw_test_cal c
    where o.organization_id = 'ee000000-0000-0000-0000-00000000000a' and o.delivery_date > c.today),
  'future orders are confirmed/pending with no run');

-- 15-16: seeding twice lives and leaves the same HR rows.
select pg_temp.impersonate('ee000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.admin_seed_realworld_data(
       'ee000000-0000-0000-0000-00000000000a',
       '{"JHR-03":"ee000000-0000-0000-0000-000000000003",
         "JHR-07":"ee000000-0000-0000-0000-000000000007",
         "JHR-12":"ee000000-0000-0000-0000-000000000012",
         "JHR-18":"ee000000-0000-0000-0000-000000000018",
         "JHR-22":"ee000000-0000-0000-0000-000000000022",
         "pool":["ee000000-0000-0000-0000-000000000031","ee000000-0000-0000-0000-000000000032"]}'::jsonb) $$,
  'seed is idempotent');
select set_config('role', 'postgres', true);
select is(
  (select count(*) from public.leave_requests
    where organization_id = 'ee000000-0000-0000-0000-00000000000a'),
  5::bigint, 'exactly 5 seeded leave requests after re-seed');

select * from finish();
rollback;
