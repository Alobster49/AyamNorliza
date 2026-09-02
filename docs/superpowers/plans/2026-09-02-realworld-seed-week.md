# Real-world seed week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Seed real-world load" produces a week of Johor operations (3 finished days, a live day, 3 planned days) plus six driver-unavailable scenarios that exercise the roster, covers and leave modules.

**Architecture:** One migration redefines `admin_seed_realworld_data(p_organization_id uuid, p_drivers jsonb)` so the whole week, the leave rows and the covers are written in one SQL transaction with deterministic ids. The server action only ensures 32 driver accounts and passes a truck-code → user-id map; the per-run `dispatch_assign_driver` loop and the regular-driver update loop go away because the SQL sets `trucks.regular_driver_id` at insert time and the existing `delivery_runs_default_driver` trigger resolves each run's driver (cover, else regular, else null on approved leave).

**Tech Stack:** Supabase/Postgres (plpgsql, pgTAP via `supabase test db`), Next.js server actions, Vitest, next-intl JSON messages.

Spec: `docs/superpowers/specs/2026-09-02-realworld-seed-week-design.md`.

## Global Constraints

- Test accounts always use password `password123` (project CLAUDE.md).
- Driver `driver<N>@gmail.com` is truck `JHR-<N>`'s regular driver for N = 1..30; driver31 and driver32 are cover-pool drivers with no truck.
- Leave dates must be workdays: `leave_requests_before_insert` recomputes `day_count` with `leave_workday_count` (Mon–Fri minus `public_holidays`) and rejects 0. Annual leave needs 7 calendar days' notice (`leave_min_notice_days`); emergency and medical need none.
- Order ids and run ids use `public._dc_uuid(org, label)` so re-seeding is idempotent.
- The demo holiday is named exactly `Cuti Umum (demo)`.
- `admin_clear_org_data` keeps `leave_requests`, `truck_covers` (cascade from trucks removes them anyway) and `public_holidays`; the seed cleans only its own rows: org covers, leave rows of the users in `p_drivers`, the demo holiday.
- Never `git checkout <path>` in this tree (other sessions' uncommitted work lives here). Commit only the files each task names.
- Local Supabase must be running for `npm run db:test`, `npm run db:reset` and `npm run db:types`.

---

### Task 1: pgTAP test for the week seed (red)

**Files:**
- Create: `supabase/tests/rls/33_realworld_seed_week.sql`

**Interfaces:**
- Consumes: nothing yet — the two-arg function does not exist, so the whole file fails until Task 2.
- Produces: the assertions Task 2 must satisfy. `p_drivers` shape: `{"JHR-03": "<uuid>", …, "pool": ["<uuid>", "<uuid>"]}`.

- [ ] **Step 1: Write the failing test**

```sql
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

-- 11: today's departed run JHR-01 is fully loaded with its first 2 stops closed.
select ok(
  (select bool_and(o.loaded_at is not null) and count(*) filter (where o.status = 'closed') = 2
     from public.orders o
     join public.delivery_runs r on r.id = o.run_id
     join public.trucks t on t.id = r.truck_id
     cross join _rw_test_cal c
    where t.code = 'JHR-01' and r.run_date = c.today),
  'JHR-01 today: all loaded, 2 closed');

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run db:test -- --file supabase/tests/rls/33_realworld_seed_week.sql` (if the CLI rejects `--file`, run `npm run db:test` and read the `33_realworld_seed_week` block).
Expected: test 1 FAILS with `function public.admin_seed_realworld_data(uuid, jsonb) does not exist`, later tests fail on counts.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/rls/33_realworld_seed_week.sql
git commit -m "test(seed): pgTAP for the real-world week seed and driver scenarios"
```

---

### Task 2: Migration — the week seed function (green)

**Files:**
- Create: `supabase/migrations/20260903000003_realworld_seed_week.sql`
- Test: `supabase/tests/rls/33_realworld_seed_week.sql` (Task 1)

**Interfaces:**
- Consumes: `public._dc_uuid(uuid, text)`, `public.admin_clear_org_data(uuid)`, triggers `delivery_runs_default_driver`, `orders_set_run_sequence_trg`, `leave_requests_before_insert_trg`, roster triggers on `trucks`/`truck_covers`.
- Produces: `public.admin_seed_realworld_data(p_organization_id uuid, p_drivers jsonb default '{}')` returning jsonb `{products, customers, zones, trucks, orders, runs, history_runs, leave_requests, truck_covers}`.

- [ ] **Step 1: Write the migration**

The catalog, depot, zones, trucks, slots and customers blocks are copied verbatim from `20260829000001_seed_setup_and_realworld.sql` lines 176–352 (`admin_seed_realworld_data`), with two changes marked `-- CHANGED`. Everything after the customers block is new.

```sql
-- 20260903000003_realworld_seed_week.sql
-- Real-world seed, week edition. Spec:
-- docs/superpowers/specs/2026-09-02-realworld-seed-week-design.md
--
-- D = today in Asia/Kuala_Lumpur. D-3..D-1 completed runs with closed
-- orders, D live (27 planned + 3 departed), D+1..D+3 confirmed/pending
-- orders waiting for Dispatch. Six driver scenarios on top (see section 4).
-- p_drivers: {"JHR-01": "<auth user id>", ..., "pool": ["<id>", "<id>"]}.
-- Missing keys simply leave that truck without a regular driver.

begin;

drop function if exists public.admin_seed_realworld_data(uuid);

create or replace function public.admin_seed_realworld_data(
  p_organization_id uuid,
  p_drivers jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_pool1 uuid := (p_drivers->'pool'->>0)::uuid;
  v_pool2 uuid := (p_drivers->'pool'->>1)::uuid;
  v_t_annual uuid;
  v_t_medical uuid;
  v_t_emergency uuid;
  v_w0 date; v_w1 date; v_w2 date; v_w3 date; v_w4 date; v_p1 date;
  v_annual_start date; v_annual_end date;
begin
  perform public.admin_clear_org_data(p_organization_id);

  -- 0. Clean what the clear deliberately keeps, but only our own rows.
  delete from public.truck_covers where organization_id = p_organization_id;
  delete from public.leave_requests
   where organization_id = p_organization_id
     and user_id in (
       select value::uuid from jsonb_each_text(p_drivers - 'pool')
       union
       select value::uuid from jsonb_array_elements_text(coalesce(p_drivers->'pool', '[]'::jsonb))
     );
  delete from public.public_holidays
   where organization_id = p_organization_id and name = 'Cuti Umum (demo)';

  -- 1. Catalog (identical to the demo seed) ---------------------------------
  insert into public.categories (id, organization_id, name, description, created_by)
  values
    (public._dc_uuid(p_organization_id, 'c001'), p_organization_id, 'Ayam Segar',
     'Whole fresh chicken, per bird or per kg', v_actor),
    (public._dc_uuid(p_organization_id, 'c002'), p_organization_id, 'Part Ayam',
     'Chicken cuts and parts, per kg', v_actor);

  insert into public.products (id, organization_id, category_id, name, image_url, created_by)
  select x.id, p_organization_id, public._dc_uuid(p_organization_id, x.category), x.name, x.image_url, v_actor
  from (values
    (public._dc_uuid(p_organization_id, '101'), 'c001', 'Ayam Pedaging Seekor (Standard)', '/product/ayam-pedaging.jpg'),
    (public._dc_uuid(p_organization_id, '102'), 'c001', 'Ayam Kampung Seekor',             '/product/ayam-kampung.jpg'),
    (public._dc_uuid(p_organization_id, '103'), 'c001', 'Ayam Tua / Penelur Seekor',       '/product/ayam-tua.jpg'),
    (public._dc_uuid(p_organization_id, '104'), 'c002', 'Dada Ayam',                       '/product/dada-ayam.png'),
    (public._dc_uuid(p_organization_id, '105'), 'c002', 'Peha Ayam',                       '/product/peha-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '106'), 'c002', 'Pangkal Peha',                    '/product/pangkal-peha.jpg'),
    (public._dc_uuid(p_organization_id, '107'), 'c002', 'Kepak Ayam',                      '/product/kepak-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '108'), 'c002', 'Chicken Wing (3-Joint)',          '/product/chicken-wing.jpg'),
    (public._dc_uuid(p_organization_id, '109'), 'c002', 'Kaki Ayam',                       '/product/kaki-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10a'), 'c002', 'Leher Ayam',                      '/product/leher-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10b'), 'c002', 'Hati Ayam',                       '/product/hati-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10c'), 'c002', 'Rangka Ayam',                     '/product/rangka-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10d'), 'c002', 'Cop Ayam',                        '/product/cop-ayam.jpg')
  ) as x(id, category, name, image_url);

  insert into public.product_variants (id, organization_id, product_id, name, created_by)
  select x.id, p_organization_id, x.product_id, x.name, v_actor
  from (values
    (public._dc_uuid(p_organization_id, '201'), public._dc_uuid(p_organization_id, '101'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '202'), public._dc_uuid(p_organization_id, '101'), 'Per ekor'),
    (public._dc_uuid(p_organization_id, '203'), public._dc_uuid(p_organization_id, '102'), 'Per ekor'),
    (public._dc_uuid(p_organization_id, '204'), public._dc_uuid(p_organization_id, '103'), 'Per ekor'),
    (public._dc_uuid(p_organization_id, '205'), public._dc_uuid(p_organization_id, '104'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '206'), public._dc_uuid(p_organization_id, '105'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '207'), public._dc_uuid(p_organization_id, '106'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '208'), public._dc_uuid(p_organization_id, '107'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '209'), public._dc_uuid(p_organization_id, '108'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '20a'), public._dc_uuid(p_organization_id, '109'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '20b'), public._dc_uuid(p_organization_id, '10a'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '20c'), public._dc_uuid(p_organization_id, '10b'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '20d'), public._dc_uuid(p_organization_id, '10c'), 'Per kg'),
    (public._dc_uuid(p_organization_id, '20e'), public._dc_uuid(p_organization_id, '10d'), 'Per kg')
  ) as x(id, product_id, name);

  -- 2. Depot, zones, trucks, slots, customers --------------------------------
  insert into public.facilities (id, organization_id, name, address_line, postcode, state, created_by)
  values (public._dc_uuid(p_organization_id, '501'), p_organization_id, 'Depoh Utama Senai',
          'Lot 8, Jalan Perindustrian Senai 3', '81400', 'Johor', v_actor);

  insert into public.bays (id, organization_id, facility_id, name, position, created_by)
  select public._dc_uuid(p_organization_id, 'bay' || b.n), p_organization_id,
         public._dc_uuid(p_organization_id, '501'), 'Bay ' || chr(64 + b.n), b.n - 1, v_actor
  from generate_series(1, 6) as b(n);

  insert into public.delivery_zones (id, organization_id, name, display_order, created_by)
  select public._dc_uuid(p_organization_id, z.label), p_organization_id, z.name, z.ord, v_actor
  from (values
    ('z01', 'Iskandar Puteri',       0),
    ('z02', 'JB Bandar',             1),
    ('z03', 'JB Utara',              2),
    ('z04', 'Skudai-Senai-Kulai',    3),
    ('z05', 'Pasir Gudang-Masai',    4),
    ('z06', 'Kota Tinggi & Mersing', 5),
    ('z07', 'Pontian',               6),
    ('z08', 'Batu Pahat',            7),
    ('z09', 'Muar & Tangkak',        8),
    ('z10', 'Kluang & Segamat',      9)
  ) as z(label, name, ord);

  insert into public.zone_postcode_ranges (id, organization_id, zone_id, postcode_start, postcode_end, created_by)
  select public._dc_uuid(p_organization_id, 'zr-' || r.n), p_organization_id,
         public._dc_uuid(p_organization_id, r.zone), r.pstart, r.pend, v_actor
  from (values
    (1,  'z01', '79000', '79999'),
    (2,  'z02', '80000', '80999'),
    (3,  'z03', '81100', '81299'),
    (4,  'z04', '81000', '81099'),
    (5,  'z04', '81300', '81699'),
    (6,  'z05', '81700', '81899'),
    (7,  'z06', '81900', '81999'),
    (8,  'z06', '86500', '86999'),
    (9,  'z07', '82000', '82999'),
    (10, 'z08', '83000', '83999'),
    (11, 'z09', '84000', '84999'),
    (12, 'z10', '85000', '86499')
  ) as r(n, zone, pstart, pend);

  -- CHANGED: driver_id column resolved from p_drivers.
  drop table if exists _rw_trucks;
  create temp table _rw_trucks on commit drop as
  select t.n, t.zone, t.name, t.capacity,
         public._dc_uuid(p_organization_id, 'trk-' || t.n) as id,
         (p_drivers->>('JHR-' || lpad(t.n::text, 2, '0')))::uuid as driver_id
  from (values
    (1,  'z01', 'Truck Iskandar Puteri 1',   1000), (2,  'z01', 'Truck Iskandar Puteri 2',    800),
    (3,  'z01', 'Truck Iskandar Puteri 3',    600), (4,  'z02', 'Truck JB Bandar 1',         1200),
    (5,  'z02', 'Truck JB Bandar 2',         1000), (6,  'z02', 'Truck JB Bandar 3',          800),
    (7,  'z02', 'Truck JB Bandar 4',          600), (8,  'z03', 'Truck JB Utara 1',          1000),
    (9,  'z03', 'Truck JB Utara 2',           800), (10, 'z03', 'Truck JB Utara 3',           600),
    (11, 'z04', 'Truck Skudai 1',            1200), (12, 'z04', 'Truck Skudai 2',            1000),
    (13, 'z04', 'Truck Senai 1',              800), (14, 'z04', 'Truck Kulai 1',              800),
    (15, 'z05', 'Truck Pasir Gudang 1',      1000), (16, 'z05', 'Truck Pasir Gudang 2',       800),
    (17, 'z05', 'Truck Masai 1',              600), (18, 'z06', 'Truck Kota Tinggi 1',        800),
    (19, 'z06', 'Truck Mersing 1',            600), (20, 'z07', 'Truck Pontian 1',            800),
    (21, 'z07', 'Truck Pontian 2',            600), (22, 'z08', 'Truck Batu Pahat 1',        1000),
    (23, 'z08', 'Truck Batu Pahat 2',         800), (24, 'z08', 'Truck Yong Peng 1',          600),
    (25, 'z09', 'Truck Muar 1',              1000), (26, 'z09', 'Truck Muar 2',               800),
    (27, 'z09', 'Truck Tangkak 1',            600), (28, 'z10', 'Truck Kluang 1',            1000),
    (29, 'z10', 'Truck Kluang 2',             800), (30, 'z10', 'Truck Segamat 1',            800)
  ) as t(n, zone, name, capacity);

  -- CHANGED: regular_driver_id set at insert (roster trigger checks membership).
  insert into public.trucks (id, organization_id, name, code, bay_id, capacity_kg, regular_driver_id, created_by)
  select t.id, p_organization_id, t.name,
         'JHR-' || lpad(t.n::text, 2, '0'),
         public._dc_uuid(p_organization_id, 'bay' || (((t.n - 1) % 6) + 1)),
         t.capacity, t.driver_id, v_actor
  from _rw_trucks t;

  insert into public.truck_zones (truck_id, zone_id, organization_id)
  select t.id, public._dc_uuid(p_organization_id, t.zone), p_organization_id
  from _rw_trucks t;

  insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, created_by)
  select p_organization_id, t.id,
         d.weekday::smallint, s.st::time, s.et::time, v_actor
  from _rw_trucks t
  cross join generate_series(0, 6) as d(weekday)
  cross join (values ('09:00', '13:00'), ('14:00', '18:00')) as s(st, et);

  drop table if exists _rw_cust;
  create temp table _rw_cust on commit drop as
  select tw.town_n, shop.n as shop_n, tw.zone, tw.town, tw.postcode,
         public._dc_uuid(p_organization_id, 'cu-' || tw.town_n || '-' || shop.n) as id,
         case shop.n
           when 1 then 'Restoran ' || (array['Selera', 'Warisan', 'Bismillah', 'Cahaya', 'Seri Wangi', 'Sup Ayam Wan', 'Nasi Ayam Hj'])[((tw.town_n + shop.n) % 7) + 1] || ' ' || tw.town
           when 2 then 'Kedai Ayam Segar ' || tw.town
           else        'Pasar Mini ' || tw.town
         end as name,
         '01' || (((tw.town_n * 7 + shop.n) % 8) + 2)::text || '-7'
              || lpad(((tw.town_n * 53 + shop.n * 17) % 1000000)::text, 6, '0') as phone,
         ((tw.town_n * 5 + shop.n * 7) % 90 + 1)::text || ' ' || tw.street || ', '
              || tw.postcode || ' ' || tw.town as address,
         row_number() over (partition by tw.zone order by tw.town_n, shop.n) as zone_seq
  from (values
    (1,  'z01', '79100', 'Iskandar Puteri', 'Persiaran Puteri Selatan'),
    (2,  'z01', '79250', 'Medini',          'Jalan Medini Utara 3'),
    (3,  'z02', '80000', 'Johor Bahru',     'Jalan Dhoby'),
    (4,  'z02', '80350', 'Johor Bahru',     'Jalan Sutera Tanjung 8/2'),
    (5,  'z03', '81100', 'Johor Bahru',     'Jalan Molek 1/9'),
    (6,  'z03', '81200', 'Tampoi',          'Jalan Tampoi Utama'),
    (7,  'z04', '81300', 'Skudai',          'Jalan Kebudayaan 4'),
    (8,  'z04', '81400', 'Senai',           'Jalan Idaman 2'),
    (9,  'z04', '81000', 'Kulai',           'Jalan Kenanga 29'),
    (10, 'z05', '81700', 'Pasir Gudang',    'Jalan Bandar'),
    (11, 'z05', '81750', 'Masai',           'Jalan Suria 12'),
    (12, 'z06', '81900', 'Kota Tinggi',     'Jalan Tun Habab'),
    (13, 'z06', '86800', 'Mersing',         'Jalan Abu Bakar'),
    (14, 'z07', '82000', 'Pontian',         'Jalan Taib'),
    (15, 'z07', '82200', 'Benut',           'Jalan Besar Benut'),
    (16, 'z08', '83000', 'Batu Pahat',      'Jalan Rahmat'),
    (17, 'z08', '83700', 'Yong Peng',       'Jalan Besar'),
    (18, 'z09', '84000', 'Muar',            'Jalan Bakri'),
    (19, 'z09', '84900', 'Tangkak',         'Jalan Muar'),
    (20, 'z10', '86000', 'Kluang',          'Jalan Duku'),
    (21, 'z10', '85000', 'Segamat',         'Jalan Genuang')
  ) as tw(town_n, zone, postcode, town, street)
  cross join generate_series(1, 3) as shop(n);

  insert into public.customers (id, organization_id, name, phone, address, postcode, created_by)
  select c.id, p_organization_id, c.name, c.phone, c.address, c.postcode, v_actor
  from _rw_cust c;

  perform public.link_or_create_customer_for_buyer(b.id)
  from public.buyers b
  where b.organization_id = p_organization_id
    and b.customer_id is null;

  -- 3. Calendar --------------------------------------------------------------
  -- A workday is Mon-Fri and not a public holiday of the org: the same rule
  -- leave_workday_count applies, so every leave below has day_count > 0.
  -- W(k) = k-th workday on/after today; P(1) = last workday before today.
  drop table if exists _rw_days;
  create temp table _rw_days on commit drop as
  select d::date as day,
         (extract(isodow from d) < 6
          and not exists (select 1 from public.public_holidays h
                          where h.organization_id = p_organization_id
                            and h.holiday_date = d::date)) as workday
  from generate_series(v_today - 10, v_today + 21, interval '1 day') d;

  select day into v_w0 from _rw_days where workday and day >= v_today order by day offset 0 limit 1;
  select day into v_w1 from _rw_days where workday and day >= v_today order by day offset 1 limit 1;
  select day into v_w2 from _rw_days where workday and day >= v_today order by day offset 2 limit 1;
  select day into v_w3 from _rw_days where workday and day >= v_today order by day offset 3 limit 1;
  select day into v_w4 from _rw_days where workday and day >= v_today order by day offset 4 limit 1;
  select max(day) into v_p1 from _rw_days where workday and day < v_today;
  -- Annual leave needs 7 calendar days' notice: first workday on/after D+7,
  -- then the next workday.
  select day into v_annual_start from _rw_days where workday and day >= v_today + 7 order by day limit 1;
  select day into v_annual_end from _rw_days where workday and day > v_annual_start order by day limit 1;

  -- 4. Driver scenarios ------------------------------------------------------
  -- Leave types exist for every org since 20260830000001; orgs created in a
  -- test fixture may lack them, so make sure the three we use are there.
  insert into public.leave_types
    (organization_id, code, name, entitlement_days, accrual, carry_forward_cap, requires_attachment, sort)
  values
    (p_organization_id, 'annual',    'Annual',    12, 'pro_rata', 6,    false, 1),
    (p_organization_id, 'medical',   'Medical',   14, 'full',     null, true,  2),
    (p_organization_id, 'emergency', 'Emergency', null, 'full',   null, false, 5)
  on conflict (organization_id, code) do nothing;

  select id into v_t_annual    from public.leave_types where organization_id = p_organization_id and code = 'annual';
  select id into v_t_medical   from public.leave_types where organization_id = p_organization_id and code = 'medical';
  select id into v_t_emergency from public.leave_types where organization_id = p_organization_id and code = 'emergency';

  -- 5. Public holiday on W4 (inserted before the leaves; none overlap it).
  insert into public.public_holidays (organization_id, holiday_date, name)
  values (p_organization_id, v_w4, 'Cuti Umum (demo)');

  -- year/day_count are recomputed by leave_requests_before_insert; the values
  -- here are placeholders that satisfy the not-null constraints.
  -- 1: driver03 emergency leave W1..W2, approved, nobody covers.
  -- 2: driver07 emergency leave W1..W3, approved, driver31 covers.
  -- 3: driver18 medical leave W0 (today when a workday), approved.
  -- 4: driver12 annual leave >= D+7, pending.
  -- 6: driver22 medical leave P1, approved, driver31 covered.
  insert into public.leave_requests
    (id, organization_id, user_id, leave_type_id, year, start_date, end_date, day_count,
     justification, status, decided_by, decided_at, decision_note)
  select public._dc_uuid(p_organization_id, s.label), p_organization_id, s.user_id, s.type_id,
         extract(year from s.start_d)::int, s.start_d, s.end_d, 1,
         s.reason, s.status,
         case when s.status = 'approved' then v_actor end,
         case when s.status = 'approved' then s.decided end,
         case when s.status = 'approved' then 'Diluluskan' end
  from (values
    ('lv-03', (p_drivers->>'JHR-03')::uuid, v_t_emergency, v_w1, v_w2, 'Urusan keluarga di kampung', 'approved', now() - interval '2 days'),
    ('lv-07', (p_drivers->>'JHR-07')::uuid, v_t_emergency, v_w1, v_w3, 'Isteri bersalin', 'approved', now() - interval '3 days'),
    ('lv-18', (p_drivers->>'JHR-18')::uuid, v_t_medical,   v_w0, v_w0, 'Demam, MC dari klinik', 'approved', now() - interval '2 hours'),
    ('lv-12', (p_drivers->>'JHR-12')::uuid, v_t_annual,    v_annual_start, v_annual_end, 'Cuti tahunan, balik kampung', 'pending', null),
    ('lv-22', (p_drivers->>'JHR-22')::uuid, v_t_medical,   v_p1, v_p1, 'Sakit perut, MC sehari', 'approved', (v_p1::timestamp + time '07:30') at time zone 'Asia/Kuala_Lumpur')
  ) as s(label, user_id, type_id, start_d, end_d, reason, status, decided)
  where s.user_id is not null;

  -- Approved rows carry the breakdown the approve RPC would have written so
  -- My Leave shows the days as used.
  update public.leave_requests
     set breakdown = jsonb_build_object('carry_forward_used', 0, 'base_used', day_count)
   where organization_id = p_organization_id
     and status = 'approved'
     and id in (public._dc_uuid(p_organization_id, 'lv-03'), public._dc_uuid(p_organization_id, 'lv-07'),
                public._dc_uuid(p_organization_id, 'lv-18'), public._dc_uuid(p_organization_id, 'lv-22'));

  -- Covers: JHR-07 on each workday W1..W3, JHR-22 on P1, both by driver31.
  insert into public.truck_covers (id, organization_id, truck_id, cover_date, driver_id, note, created_by)
  select public._dc_uuid(p_organization_id, 'cv-07-' || d.day), p_organization_id,
         public._dc_uuid(p_organization_id, 'trk-7'), d.day, v_pool1,
         'Ganti Khairul (cuti kecemasan)', v_actor
  from _rw_days d
  where v_pool1 is not null and d.workday and d.day between v_w1 and v_w3
  union all
  select public._dc_uuid(p_organization_id, 'cv-22-' || v_p1), p_organization_id,
         public._dc_uuid(p_organization_id, 'trk-22'), v_p1, v_pool1,
         'Ganti Rahim (MC)', v_actor
  where v_pool1 is not null;

  -- 6. Operating days --------------------------------------------------------
  -- off: -3..3. Stops per truck by weekday (Fri/Sat busiest, Mon quiet).
  -- Future days skip the demo holiday.
  drop table if exists _rw_ops;
  create temp table _rw_ops on commit drop as
  select o.off, (v_today + o.off)::date as day,
         case when o.off < 0 then 'history' when o.off = 0 then 'today' else 'future' end as kind,
         case
           when o.off = 0 then 5
           when o.off < 0 then case extract(isodow from v_today + o.off) when 5 then 6 when 6 then 6 when 1 then 4 else 5 end
           else               case extract(isodow from v_today + o.off) when 5 then 5 when 6 then 5 when 1 then 3 else 4 end
         end as stops
  from generate_series(-3, 3) as o(off)
  where (v_today + o.off) <> v_w4 or o.off <= 0;

  -- Runs for history + today; driver_id is left null so the
  -- delivery_runs_default_driver trigger resolves cover -> regular -> null on
  -- approved leave, exactly as Dispatch would.
  insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
  select public._dc_uuid(p_organization_id, 'run-' || d.off || '-' || t.n), p_organization_id,
         t.id, d.day,
         case when d.off < 0 then 'completed'
              when t.n in (1, 11, 21) then 'departed'
              else 'planned' end::public.delivery_run_status
  from _rw_ops d cross join _rw_trucks t
  where d.off <= 0;

  -- 7. Stops -----------------------------------------------------------------
  -- One row per (day, truck, stop). Customers rotate through the truck's
  -- zone with stride 1 (coprime with zone sizes 6 and 9), offset per truck
  -- and per day so no two trucks or days serve identical lists. Every 12th
  -- history stop failed (shop closed) and moved to the next day.
  -- Future days add one unassigned pending order per zone on its first truck.
  drop table if exists _rw_stops;
  create temp table _rw_stops on commit drop as
  select
    d.off, d.day, d.kind, t.n, t.zone, t.id as truck_id, s.s,
    c.id as customer_id, c.address, c.postcode,
    (d.kind = 'history' and ((t.n * 5 + s.s + d.off) % 12) = 0) as failed,
    false as pending
  from _rw_ops d
  cross join _rw_trucks t
  cross join lateral generate_series(1, d.stops) as s(s)
  join _rw_cust c
    on c.zone = t.zone
   and c.zone_seq = ((t.n * 2 + s.s + (d.off + 3) * 3)
         % (select count(*) from _rw_cust c2 where c2.zone = t.zone)) + 1
  union all
  select
    d.off, d.day, d.kind, z.first_n, z.zone, z.truck_id, 99,
    c.id, c.address, c.postcode, false, true
  from _rw_ops d
  cross join (
    select t.zone, min(t.n) as first_n,
           public._dc_uuid(p_organization_id, 'trk-' || min(t.n)) as truck_id
    from _rw_trucks t group by t.zone
  ) z
  join _rw_cust c
    on c.zone = z.zone
   and c.zone_seq = ((z.first_n + d.off * 5) % (select count(*) from _rw_cust c2 where c2.zone = z.zone)) + 1
  where d.kind = 'future';

  -- Where each order ends up. A failed history stop is re-dated to the next
  -- day on the same truck's run; if that day is still history it is
  -- delivered there, if it is today it waits as a ready stop.
  alter table _rw_stops
    add column final_off int,
    add column final_day date,
    add column run_id uuid,
    add column orig_run_id uuid,
    add column status public.order_status,
    add column loaded boolean,
    add column closed_at timestamptz;

  update _rw_stops s set
    final_off = s.off + case when s.failed then 1 else 0 end,
    final_day = s.day + case when s.failed then 1 else 0 end;

  update _rw_stops s set
    orig_run_id = case when s.off <= 0 then public._dc_uuid(p_organization_id, 'run-' || s.off || '-' || s.n) end,
    run_id      = case when s.final_off <= 0 then public._dc_uuid(p_organization_id, 'run-' || s.final_off || '-' || s.n) end,
    status = case
      when s.pending then 'pending'
      when s.kind = 'future' then 'confirmed'
      when s.final_off < 0 then 'closed'
      when s.final_off = 0 and s.kind = 'today' and s.n in (1, 11, 21) and s.s <= 2 then 'closed'
      else 'ready'
    end::public.order_status,
    loaded = case
      when s.final_off < 0 then true
      when s.final_off = 0 and s.kind = 'today' and s.n in (1, 11, 21) then true
      when s.final_off = 0 and s.kind = 'today' and s.s <= 2 then true
      else false
    end;

  -- Delivery clock: run leaves the depot 09:00 KL, stops are 25 minutes apart.
  update _rw_stops s set
    closed_at = ((s.final_day::timestamp + time '09:30') at time zone 'Asia/Kuala_Lumpur') + (s.s * interval '25 minutes')
  where s.status = 'closed';

  -- Orders. run_sequence comes from the BEFORE INSERT trigger in insertion
  -- order, so ORDER BY run, day, stop fixes the route.
  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    assignment_source, loaded_at, loaded_by, closed_at
  )
  select
    public._dc_uuid(p_organization_id, 'ro-' || s.off || '-' || s.n || '-' || s.s),
    p_organization_id, s.customer_id, v_actor, 'manual', s.status,
    public._dc_uuid(p_organization_id, s.zone),
    s.address, s.postcode, s.final_day,
    (select sl.id from public.delivery_slots sl
      where sl.organization_id = p_organization_id
        and sl.truck_id = s.truck_id
        and sl.weekday = extract(dow from s.final_day)::smallint
        and sl.start_time = '09:00'::time limit 1),
    s.truck_id, s.run_id,
    case when s.pending then 'none' else 'auto' end::public.assignment_source,
    case when s.loaded then ((s.final_day::timestamp + time '07:00') at time zone 'Asia/Kuala_Lumpur') end,
    case when s.loaded then v_actor end,
    s.closed_at
  from _rw_stops s
  order by s.final_off, s.n, s.off, s.s;

  -- 8. Items -----------------------------------------------------------------
  -- Line 1: whole birds by piece. Line 2 on every other stop: a cut by kg.
  -- pending: raw request (no price, no weight); confirmed: price only;
  -- ready/closed: warehouse weight + price; closed: final weight too.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, price_per_kg, final_weight_kg, final_pieces
  )
  select
    public._dc_uuid(p_organization_id, 'ri-' || s.off || '-' || s.n || '-' || s.s || '-1'),
    public._dc_uuid(p_organization_id, 'ro-' || s.off || '-' || s.n || '-' || s.s),
    public._dc_uuid(p_organization_id,
      case (s.n + s.s) % 3 when 0 then '101' when 1 then '102' else '103' end),
    'piece', (4 + ((s.n * 7 + s.s * 3) % 9))::numeric, 1.2, 1.8, 'mix',
    case when s.status in ('ready', 'closed')
      then round(((4 + ((s.n * 7 + s.s * 3) % 9)) * (1.3 + ((s.n + s.s) % 5) * 0.1))::numeric, 1) end,
    case when s.status <> 'pending'
      then (case (s.n + s.s) % 3 when 0 then 9.50 when 1 then 16.00 else 8.00 end) end,
    case when s.status = 'closed'
      then round(((4 + ((s.n * 7 + s.s * 3) % 9)) * (1.3 + ((s.n + s.s) % 5) * 0.1))::numeric, 1) end,
    case when s.status = 'closed' then 4 + ((s.n * 7 + s.s * 3) % 9) end
  from _rw_stops s;

  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, price_per_kg, final_weight_kg
  )
  select
    public._dc_uuid(p_organization_id, 'ri-' || s.off || '-' || s.n || '-' || s.s || '-2'),
    public._dc_uuid(p_organization_id, 'ro-' || s.off || '-' || s.n || '-' || s.s),
    public._dc_uuid(p_organization_id,
      (array['104','105','106','107','108','109','10a','10b','10c','10d'])[((s.n * 3 + s.s) % 10) + 1]),
    'kg', (2 + ((s.n * 5 + s.s * 7) % 8))::numeric, 0.2, 0.5, 'mix',
    case when s.status in ('ready', 'closed') then (2 + ((s.n * 5 + s.s * 7) % 8))::numeric + 0.2 end,
    case when s.status <> 'pending'
      then (array[13.50, 13.00, 12.50, 16.50, 15.50, 6.50, 7.00, 8.50, 4.50, 9.00]::numeric[])[((s.n * 3 + s.s) % 10) + 1] end,
    case when s.status = 'closed' then (2 + ((s.n * 5 + s.s * 7) % 8))::numeric + 0.2 end
  from _rw_stops s
  where (s.n + s.s) % 2 = 0 and not s.pending;

  -- Closed orders total what the driver keyed at the door.
  update public.orders o
     set total_amount = coalesce((select sum(i.line_total) from public.order_items i where i.order_id = o.id), 0)
   where o.organization_id = p_organization_id and o.status = 'closed';

  -- 9. Tasks and weight logs -------------------------------------------------
  insert into public.order_tasks (organization_id, order_id, type, status, done_by, done_at)
  select p_organization_id,
         public._dc_uuid(p_organization_id, 'ro-' || s.off || '-' || s.n || '-' || s.s),
         'allocate_weigh',
         case when s.status = 'confirmed' then 'pending' else 'done' end::public.order_task_status,
         case when s.status <> 'confirmed' then v_actor end,
         case when s.status <> 'confirmed' then (s.day::timestamp + time '05:30') at time zone 'Asia/Kuala_Lumpur' end
  from _rw_stops s
  where not s.pending;

  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by, recorded_at)
  select p_organization_id, i.id, 'warehouse', i.warehouse_weight_kg, v_actor,
         (o.delivery_date::timestamp + time '05:45') at time zone 'Asia/Kuala_Lumpur'
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.organization_id = p_organization_id and i.warehouse_weight_kg is not null;

  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by, recorded_at)
  select p_organization_id, i.id, 'final', i.final_weight_kg,
         coalesce(r.driver_id, v_actor), o.closed_at
  from public.order_items i
  join public.orders o on o.id = i.order_id
  left join public.delivery_runs r on r.id = o.run_id
  where o.organization_id = p_organization_id and i.final_weight_kg is not null;

  -- 10. Attempts and stop events --------------------------------------------
  -- Failed first attempts on the original run.
  insert into public.delivery_attempts (
    organization_id, run_id, order_id, outcome, reason, next_action, note, attempted_at, recorded_by
  )
  select p_organization_id, s.orig_run_id,
         public._dc_uuid(p_organization_id, 'ro-' || s.off || '-' || s.n || '-' || s.s),
         'failed', 'shop_closed', 'move_tomorrow', 'Kedai tutup, hantar esok',
         ((s.day::timestamp + time '09:30') at time zone 'Asia/Kuala_Lumpur') + (s.s * interval '25 minutes'),
         coalesce(r.driver_id, v_actor)
  from _rw_stops s
  left join public.delivery_runs r on r.id = s.orig_run_id
  where s.failed;

  -- Delivered attempts for every closed order, cash = total.
  insert into public.delivery_attempts (
    organization_id, run_id, order_id, outcome, received_by, cash_collected, attempted_at, recorded_by
  )
  select p_organization_id, o.run_id, o.id, 'delivered',
         (array['Tauke', 'Kak Ros', 'Abang Man', 'Pekerja kedai'])[(abs(hashtext(o.id::text)) % 4) + 1],
         o.total_amount, o.closed_at, coalesce(r.driver_id, v_actor)
  from public.orders o
  left join public.delivery_runs r on r.id = o.run_id
  where o.organization_id = p_organization_id and o.status = 'closed';

  -- Arrive/leave marks for every attempt.
  insert into public.run_stop_events (organization_id, run_id, order_id, kind, at, recorded_by)
  select p_organization_id, a.run_id, a.order_id, e.kind,
         a.attempted_at + e.delta, a.recorded_by
  from public.delivery_attempts a
  cross join (values ('arrive'::public.stop_event_kind, interval '-8 minutes'),
                     ('leave'::public.stop_event_kind,  interval '2 minutes')) as e(kind, delta)
  where a.organization_id = p_organization_id;

  return jsonb_build_object(
    'products',       (select count(*) from public.products       where organization_id = p_organization_id),
    'customers',      (select count(*) from public.customers      where organization_id = p_organization_id),
    'zones',          (select count(*) from public.delivery_zones where organization_id = p_organization_id),
    'trucks',         (select count(*) from public.trucks         where organization_id = p_organization_id),
    'orders',         (select count(*) from public.orders         where organization_id = p_organization_id),
    'runs',           (select count(*) from public.delivery_runs  where organization_id = p_organization_id),
    'history_runs',   (select count(*) from public.delivery_runs  where organization_id = p_organization_id and run_date < v_today),
    'leave_requests', (select count(*) from public.leave_requests where organization_id = p_organization_id
                         and id in (select public._dc_uuid(p_organization_id, x) from unnest(array['lv-03','lv-07','lv-18','lv-12','lv-22']) x)),
    'truck_covers',   (select count(*) from public.truck_covers   where organization_id = p_organization_id)
  );
end;
$$;

revoke all on function public.admin_seed_realworld_data(uuid, jsonb) from public;
grant execute on function public.admin_seed_realworld_data(uuid, jsonb) to authenticated;

commit;
```

Column names to double-check before running (the implementer verifies each against the schema and adjusts the SQL, not the test):
- `order_tasks.status` is `public.order_task_status` (verified).
- `order_weight_log.recorded_at` exists (if the column is `created_at` only, drop `recorded_at` from both weight-log inserts).
- `orders.loaded_at` / `loaded_by` exist (used by the current seed, so yes).

- [ ] **Step 2: Reset and run the pgTAP suite**

Run: `npm run db:reset` then `npm run db:test`
Expected: `33_realworld_seed_week` reports `16/16` passing; every other file stays green (`16_data_console` still passes because the demo seed is untouched).

If test 8 fails only because today is a public holiday in the org calendar, that is the "MC next workday" branch: the assertion already handles it via `w0 = today`; re-read the seed's `_rw_days` definition — both must exclude holidays.

- [ ] **Step 3: Regenerate DB types**

Run: `npm run db:types`
Expected: `src/types/database.generated.ts` now shows

```ts
      admin_seed_realworld_data: {
        Args: { p_drivers?: Json; p_organization_id: string }
        Returns: Json
      }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260903000003_realworld_seed_week.sql src/types/database.generated.ts
git commit -m "feat(seed): real-world load spans a week with leave, covers and history"
```

---

### Task 3: 32 driver accounts (two cover-pool drivers)

**Files:**
- Modify: `src/features/data-console/lib/accounts.ts:40-70`
- Modify: `src/components/forms/login-form.tsx:84-92`
- Test: `src/features/data-console/tests/unit/console-accounts.test.ts:35-56`

**Interfaces:**
- Produces: `REALWORLD_DRIVER_ACCOUNTS: readonly { email; displayName; role: "driver"; truckCode: string | null }[]` of length 32; entries 31 and 32 have `truckCode: null`.

- [ ] **Step 1: Update the failing test**

Replace the `REALWORLD_DRIVER_ACCOUNTS` describe block with:

```ts
describe("REALWORLD_DRIVER_ACCOUNTS", () => {
  it("fields 30 truck drivers, driver<N> on truck JHR-<N>, plus 2 cover-pool drivers", () => {
    expect(REALWORLD_DRIVER_ACCOUNTS).toHaveLength(32);
    for (const [i, driver] of REALWORLD_DRIVER_ACCOUNTS.entries()) {
      const n = i + 1;
      expect(driver.email).toBe(`driver${n}@gmail.com`);
      expect(driver.role).toBe("driver");
      if (n <= 30) {
        expect(driver.truckCode).toBe(`JHR-${String(n).padStart(2, "0")}`);
      } else {
        expect(driver.truckCode).toBeNull();
      }
    }
  });

  it("gives every driver a distinct display name", () => {
    const names = REALWORLD_DRIVER_ACCOUNTS.map((d) => d.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the demo drivers' emails as a strict prefix, so the two seeds share logins", () => {
    expect(REALWORLD_DRIVER_ACCOUNTS.slice(0, 2).map((d) => d.email)).toEqual(
      CONSOLE_DRIVER_EMAILS,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/data-console/tests/unit/console-accounts.test.ts`
Expected: FAIL — `expected [] to have a length of 32 but got 30`.

- [ ] **Step 3: Extend the accounts list**

In `accounts.ts` replace the names array and the map:

```ts
/**
 * The real-world seed's driver fleet: one driver per truck for JHR-01..30
 * (driver<N>@gmail.com always drives truck JHR-<N>) plus two cover-pool
 * drivers, driver31 and driver32, who have no truck of their own and step in
 * when a regular driver is on leave (see the roster). The data console's
 * real-world seed action ensures all 32 accounts exist and hands the
 * truck-code -> user-id map to the SQL seed, which sets each truck's regular
 * driver and books the leave/cover scenarios.
 *
 * driver1/driver2 overlap the demo seed's CONSOLE_ACCOUNTS on purpose (same
 * emails, so the two seeds never strand a login); whichever seed ran last
 * owns the display name.
 */
const REALWORLD_DRIVER_NAMES = [
  "Azman Ismail", "Faizal Rahman", "Syafiq Hassan", "Hairul Anuar",
  "Zulkifli Omar", "Ridzuan Baharin", "Khairul Amin", "Nazri Salleh",
  "Firdaus Yusof", "Amirul Hakim", "Shahrul Nizam", "Izwan Roslan",
  "Hafizi Bakar", "Rosli Ahmad", "Saiful Azhar", "Zainal Abidin",
  "Megat Danial", "Farid Kamal", "Asyraf Zainuddin", "Lokman Hakim",
  "Syazwan Idris", "Rahim Daud", "Aiman Zaki", "Halim Osman",
  "Nabil Fikri", "Imran Shah", "Taufik Hidayat", "Zaidi Musa",
  "Akmal Hafiz", "Sulaiman Jaafar",
  // Cover pool: no regular truck.
  "Hakim Roslan", "Fauzi Mansor",
] as const;

/** Trucks JHR-01..JHR-30 have a regular driver; the rest of the list is the cover pool. */
const TRUCK_DRIVER_COUNT = 30;

export const REALWORLD_DRIVER_ACCOUNTS = REALWORLD_DRIVER_NAMES.map(
  (name, i) => ({
    email: `driver${i + 1}@gmail.com`,
    displayName: name,
    role: "driver" as const,
    truckCode:
      i < TRUCK_DRIVER_COUNT
        ? `JHR-${String(i + 1).padStart(2, "0")}`
        : null,
  }),
);
```

- [ ] **Step 4: Show the pool drivers in the dev sign-in**

In `login-form.tsx` the driver picker uses `truckCode` as the badge; a null code needs a label. Change the mapping to:

```ts
const devDriverLogins =
  process.env.NODE_ENV === "production"
    ? []
    : REALWORLD_DRIVER_ACCOUNTS.map((driver) => ({
        label: driver.displayName,
        role: driver.truckCode ?? "Cover pool",
        email: driver.email,
        password: "password123",
      }));
```

Update the comment above it: "The 32-driver fleet from the real-world seed (30 truck drivers + 2 cover-pool drivers)".

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/features/data-console/tests/unit/console-accounts.test.ts && npm run typecheck`
Expected: 6 tests pass; typecheck clean. If typecheck reports `actions.ts` because `driver.truckCode` may be null, that is fixed in Task 4 — note it and continue.

- [ ] **Step 6: Commit**

```bash
git add src/features/data-console/lib/accounts.ts src/components/forms/login-form.tsx src/features/data-console/tests/unit/console-accounts.test.ts
git commit -m "feat(seed): two cover-pool drivers in the real-world fleet"
```

---

### Task 4: Server action passes the driver map; drop the assignment loops

**Files:**
- Modify: `src/features/data-console/server/actions.ts:211-330`

**Interfaces:**
- Consumes: `admin_seed_realworld_data(p_organization_id, p_drivers)` from Task 2; `REALWORLD_DRIVER_ACCOUNTS` with nullable `truckCode` from Task 3.
- Produces: unchanged `seedRealworldData(organizationSlug): ActionResult<{ summary: Record<string, number> }>`.

- [ ] **Step 1: Build the driver map instead of the truck map**

Replace the `driverByTruck` declaration and the driver loop body (lines ~228-265) so the map has one key per truck code plus a `pool` array:

```ts
  // Office accounts stay the demo set; the driver fleet is the 32 real-world
  // drivers: one per truck plus two in the cover pool. p_drivers maps
  // JHR-<N> -> auth user id (the truck's regular driver) and "pool" -> the
  // cover drivers, so the SQL seed can set regular drivers, book leave and
  // assign covers in one transaction.
  const officeAccounts = CONSOLE_ACCOUNTS.filter((a) => a.role !== "driver");
  const driverMap: Record<string, string | string[]> = {};
  const pool: string[] = [];
  try {
    for (const account of officeAccounts) {
      /* unchanged */
    }
    for (const driver of REALWORLD_DRIVER_ACCOUNTS) {
      const isSelf = driver.email.toLowerCase() === actingEmail;
      const userId = isSelf
        ? ctx.userId
        : await admin.ensureUserWithPassword({
            email: driver.email,
            password: CONSOLE_PASSWORD,
            displayName: driver.displayName,
          });
      await admin.upsertProfileAndMembership({
        userId,
        displayName: driver.displayName,
        organizationId: ctx.orgId,
        role: driver.role,
        invitedBy: ctx.userId,
      });
      if (driver.truckCode) driverMap[driver.truckCode] = userId;
      else pool.push(userId);
    }
    driverMap.pool = pool;
  } catch (e) {
    /* unchanged */
  }
```

- [ ] **Step 2: Call the two-arg RPC and delete the loops**

```ts
  const { data, error } = await supabase.rpc("admin_seed_realworld_data", {
    p_organization_id: ctx.orgId,
    p_drivers: driverMap,
  });
  if (error) {
    const forbidden = error.message === "forbidden";
    return {
      ok: false,
      code: forbidden ? "forbidden" : "internal",
      message: forbidden ? "Owner only." : "Seeding failed and was rolled back.",
    };
  }
  const summary = (data ?? {}) as Record<string, number>;
```

Delete the block that selected `delivery_runs` and called `dispatch_assign_driver` per run, and the block that updated `trucks.regular_driver_id` per truck (the SQL does both now). In the audit `after`, replace `drivers: driverByTruck.size` with `drivers: REALWORLD_DRIVER_ACCOUNTS.length`.

- [ ] **Step 3: Typecheck and unit tests**

Run: `npm run typecheck && npx vitest run src/features/data-console`
Expected: clean; all data-console tests pass. If `p_drivers` is rejected by the generated `Json` type, cast: `p_drivers: driverMap as unknown as Json` with `import type { Json } from "@/types/database.generated"` (check how other actions import `Json`).

- [ ] **Step 4: Commit**

```bash
git add src/features/data-console/server/actions.ts
git commit -m "feat(seed): pass the driver map to the SQL seed, drop per-run assignment"
```

---

### Task 5: Console and summary copy (en + ms)

**Files:**
- Modify: `src/messages/en.json:2457,2482-2490`
- Modify: `src/messages/ms.json:2457,2482-2490` (same keys)
- Regenerate: `src/messages/en.d.json.ts` (run whatever script the repo uses — check `package.json` for `i18n`/`messages` scripts; if none, the `.d.json.ts` is a checked-in generated declaration and must be updated by re-running the generator noted at its top comment)

- [ ] **Step 1: English**

```json
"seededRealworldSummary": "Seeded {trucks, plural, one {# truck} other {# trucks}} across {zones, plural, one {# zone} other {# zones}}, {customers, plural, one {# customer} other {# customers}}, {orders, plural, one {# order} other {# orders}} and {runs, plural, one {# run} other {# runs}} over the week. Drivers 1-32 can now sign in.",
```

```json
"realworldCard": {
  "title": "Seed real-world load",
  "description": "A full Johor operation across one week: 10 zones with real postcode ranges, 30 trucks, 32 driver accounts, and about 1,000 orders — 3 days already delivered, today live with 30 runs, and 3 days waiting for Dispatch.",
  "detail": "Driver 1-30 accounts (driver1@gmail.com …) are each truck's regular driver; driver31 and driver32 are the cover pool. The seed books leave for five drivers: two on emergency leave (one covered, one not), one on MC today, one with a pending annual request, and one covered in last week's history — so the Driver roster, Leave Management and run history have something real to show.",
  "trigger": "Seed real-world load",
  "dialogTitle": "Seed the real-world load?",
  "dialogDescription": "This clears existing data first, then creates the full Johor week: 10 zones, 30 trucks with drivers, about 1,000 orders across 7 days, and the leave and cover scenarios. Seeding takes a moment.",
  "confirm": "Seed real-world load"
}
```

- [ ] **Step 2: Malay**

```json
"seededRealworldSummary": "Disemai {trucks, plural, one {# lori} other {# lori}} merentasi {zones, plural, one {# zon} other {# zon}}, {customers, plural, one {# pelanggan} other {# pelanggan}}, {orders, plural, one {# pesanan} other {# pesanan}} dan {runs, plural, one {# trip} other {# trip}} sepanjang minggu ini. Pemandu 1-32 kini boleh log masuk.",
```

```json
"realworldCard": {
  "title": "Semai beban dunia sebenar",
  "description": "Operasi Johor penuh selama seminggu: 10 zon dengan julat poskod sebenar, 30 lori, 32 akaun pemandu, dan kira-kira 1,000 pesanan — 3 hari sudah dihantar, hari ini langsung dengan 30 trip, dan 3 hari menunggu Dispatch.",
  "detail": "Akaun Pemandu 1-30 (driver1@gmail.com …) ialah pemandu tetap setiap lori; driver31 dan driver32 ialah pemandu ganti. Semaian ini menempah cuti untuk lima pemandu: dua cuti kecemasan (seorang ada pengganti, seorang tiada), seorang MC hari ini, seorang permohonan cuti tahunan belum diluluskan, dan seorang diganti dalam sejarah minggu lepas — supaya Jadual pemandu, Pengurusan Cuti dan sejarah trip ada data sebenar.",
  "trigger": "Semai beban dunia sebenar",
  "dialogTitle": "Semai beban dunia sebenar?",
  "dialogDescription": "Ini akan memadam data sedia ada dahulu, kemudian mencipta minggu Johor penuh: 10 zon, 30 lori dengan pemandu, kira-kira 1,000 pesanan merentasi 7 hari, serta senario cuti dan pengganti. Semaian mengambil sedikit masa.",
  "confirm": "Semai beban dunia sebenar"
}
```

- [ ] **Step 3: Typecheck (declaration in sync)**

Run: `npm run typecheck`
Expected: clean. Key names did not change, so `en.d.json.ts` needs no change unless the generator also embeds values; if it does, re-run the generator.

- [ ] **Step 4: Commit**

```bash
git add src/messages/en.json src/messages/ms.json src/messages/en.d.json.ts
git commit -m "docs(seed): console copy describes the week and the driver scenarios"
```

---

### Task 6: Browser verification on the seeded workspace

**Files:** none (verification only). Use `read_page`, not screenshots, until the final proof.

- [ ] **Step 1: Reset and seed**

Run: `npm run db:reset` (local Supabase). Start the dev server via `preview_start` (`.claude/launch.json` entry for the Next app, port from `package.json`). Sign in as `admin@gmail.com` / `password123` (dev picker), open Data console, click **Seed real-world load**, confirm.
Expected: success message reads about 1,000 orders and 120 runs; no error toast.

- [ ] **Step 2: Roster**

Open `/ayam-norliza-pilot/roster` (as admin).
Expected via `read_page`: gaps count ≥ 2 (JHR-03 on W1 and W2; JHR-18 today when a workday), JHR-07 cells W1..W3 show the cover driver "Hakim Roslan", an "at risk" item for JHR-12, holiday shading on W4, driver31/32 in the cover pool band.

- [ ] **Step 3: Delivery runs and Dispatch**

Open `/ayam-norliza-pilot/runs`: history days show completed runs, today shows 3 departed and 27 planned, JHR-18 today has no driver (on a workday). Open `/ayam-norliza-pilot/dispatch` for D+1: confirmed orders sit on their trucks with no run; pending orders wait in the pool.

- [ ] **Step 4: Drivers and HR**

Sign in as `driver1@gmail.com`: deck shows today's departed run with 2 delivered stops and 3 remaining. Sign in as `driver31@gmail.com`: no run today. Sign in as `hr@gmail.com`: Leave Management shows one pending request (driver12, annual) and the approved ones in history.

- [ ] **Step 5: Proof and mobile**

`resize_window` to 390 wide, open `/roster` Gaps tab and confirm no horizontal page scroll (`document.documentElement.scrollWidth <= window.innerWidth` via `javascript_tool`). Take one screenshot of the roster at 1440 as the final proof and send it with `SendUserFile`.

- [ ] **Step 6: Record**

No commit. Report the counts observed and any scenario that did not render as described, then hand over per `superpowers:finishing-a-development-branch`.

---

## Self-review

- Spec coverage: week table → Task 2 sections 6–10; scenarios 1–6 → Task 2 section 4–5 (scenario 1 & 2 use emergency leave because annual needs 7 days' notice — spec updated in the same commit as Task 2 if it still says annual); pool drivers → Task 3; action + loops removed → Task 4; copy → Task 5; pgTAP → Task 1; browser check → Task 6; regenerated types → Task 2 step 3.
- Spec deviation to record in the spec's Decisions section during Task 2: runs are inserted without `driver_id` and the existing trigger resolves it (same result, less code); approved leave rows get `breakdown` via a follow-up update because the insert trigger recomputes `day_count`.
- Type consistency: `p_drivers` keys `JHR-NN` + `pool` in Task 1 test, Task 2 SQL and Task 4 action; `truckCode: string | null` in Task 3 and consumed with a truthiness check in Task 4 and `?? "Cover pool"` in the login form.
