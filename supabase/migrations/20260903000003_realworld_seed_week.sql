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
  v_t_annual uuid;
  v_t_medical uuid;
  v_t_emergency uuid;
  v_w0 date; v_w1 date; v_w2 date; v_w3 date; v_w4 date; v_p1 date;
  v_annual_start date; v_annual_end date;
begin
  perform public.admin_clear_org_data(p_organization_id);

  -- 0. Clean what the clear deliberately keeps, but only our own rows.
  -- Belt-and-braces: admin_clear_org_data deletes trucks, and truck_covers
  -- cascades from truck_id, so this delete is already a no-op by the time we
  -- get here.
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
  -- P1 must land inside the seeded history window (D-3..D-1): a long weekend
  -- or holiday run of non-workdays before today can otherwise push the last
  -- workday back past D-3, to a day with no history run at all. Clamp it and
  -- let scenario 6 (below) drop out cleanly when there is no such day.
  select max(day) into v_p1 from _rw_days where workday and day < v_today and day >= v_today - 3;
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
  -- W4 (the 5th workday on/after today) always falls beyond the seeded order
  -- window (D+1..D+3), so it never suppresses an order day by construction --
  -- it exists purely so the Driver roster has a holiday to shade.
  insert into public.public_holidays (organization_id, holiday_date, name)
  values (p_organization_id, v_w4, 'Cuti Umum (demo)');

  -- year/day_count are recomputed by leave_requests_before_insert; the values
  -- here are placeholders that satisfy the not-null constraints.
  -- 1: driver03 emergency leave W1..W2, approved, nobody covers.
  -- W1..W3 below is a calendar range (start_date..end_date) but the cover
  -- rows further down are written only on workdays in that range, so if the
  -- range spans a weekend the roster shows JHR-07 on leave with no cover on
  -- the Saturday/Sunday in between -- intended, nobody covers a weekend.
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
    ('lv-12', (p_drivers->>'JHR-12')::uuid, v_t_annual,    v_annual_start, coalesce(v_annual_end, v_annual_start), 'Cuti tahunan, balik kampung', 'pending', null),
    ('lv-22', (p_drivers->>'JHR-22')::uuid, v_t_medical,   v_p1, v_p1, 'Sakit perut, MC sehari', 'approved', (v_p1::timestamp + time '07:30') at time zone 'Asia/Kuala_Lumpur')
  ) as s(label, user_id, type_id, start_d, end_d, reason, status, decided)
  where s.user_id is not null and s.start_d is not null;

  -- Approved rows carry the breakdown the approve RPC would have written so
  -- My Leave shows the days as used.
  update public.leave_requests
     set breakdown = jsonb_build_object('carry_forward_used', 0, 'base_used', day_count)
   where organization_id = p_organization_id
     and status = 'approved'
     and id in (public._dc_uuid(p_organization_id, 'lv-03'), public._dc_uuid(p_organization_id, 'lv-07'),
                public._dc_uuid(p_organization_id, 'lv-18'), public._dc_uuid(p_organization_id, 'lv-22'));

  -- Covers: JHR-07 on each workday W1..W3, JHR-22 on P1, both by driver31.
  -- JHR-22's cover is skipped when v_p1 is null (see the P1 clamp above): the
  -- lv-22 leave row was already skipped for the same reason, so there is
  -- nothing to cover.
  insert into public.truck_covers (id, organization_id, truck_id, cover_date, driver_id, note, created_by)
  select public._dc_uuid(p_organization_id, 'cv-07-' || d.day), p_organization_id,
         public._dc_uuid(p_organization_id, 'trk-7'), d.day, v_pool1,
         'Ganti pemandu tetap (cuti kecemasan)', v_actor
  from _rw_days d
  where v_pool1 is not null and d.workday and d.day between v_w1 and v_w3
  union all
  select public._dc_uuid(p_organization_id, 'cv-22-' || v_p1), p_organization_id,
         public._dc_uuid(p_organization_id, 'trk-22'), v_p1, v_pool1,
         'Ganti pemandu tetap (MC)', v_actor
  where v_pool1 is not null and v_p1 is not null;

  -- 6. Operating days --------------------------------------------------------
  -- off: -3..3. Stops per truck by weekday (Fri/Sat busiest, Mon quiet).
  -- v_w4 (the 5th workday on/after today) is always >= D+4, past this D-3..D+3
  -- window, so it never needs to be excluded here.
  drop table if exists _rw_ops;
  create temp table _rw_ops on commit drop as
  select o.off, (v_today + o.off)::date as day,
         case when o.off < 0 then 'history' when o.off = 0 then 'today' else 'future' end as kind,
         case
           when o.off = 0 then 5
           when o.off < 0 then case extract(isodow from v_today + o.off) when 5 then 6 when 6 then 6 when 1 then 4 else 5 end
           else               case extract(isodow from v_today + o.off) when 5 then 5 when 6 then 5 when 1 then 3 else 4 end
         end as stops
  from generate_series(-3, 3) as o(off);

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

  -- PostgREST's authenticator role loads the safeupdate extension, which
  -- refuses any UPDATE/DELETE without a WHERE clause -- even one running
  -- inside this security-definer function on a temp table. `where true`
  -- satisfies it without changing which rows are touched. pgTAP cannot load
  -- safeupdate into its own session, so calling this RPC through PostgREST
  -- (as the data console does) is the only check that exercises this path.
  update _rw_stops s set
    final_off = s.off + case when s.failed then 1 else 0 end,
    final_day = s.day + case when s.failed then 1 else 0 end
  where true;

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
      -- Departed trucks load the whole manifest this morning, including a
      -- D-1 failed stop carried over to today (final_off = 0, kind = 'history').
      when s.final_off = 0 and s.n in (1, 11, 21) then true
      when s.final_off = 0 and s.kind = 'today' and s.s <= 2 then true
      else false
    end
  where true;

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
