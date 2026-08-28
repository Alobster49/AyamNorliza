-- 20260829000001_seed_setup_and_realworld.sql
-- Two new console seeds beside admin_seed_demo_data:
--
-- 1. admin_seed_setup_data: catalog + customers + delivery setup only --
--    no orders, no runs. For starting a clean pilot where the office enters
--    its own orders but does not want to hand-type the master data.
--
-- 2. admin_seed_realworld_data: a full-scale "one company covers Johor"
--    load test. 10 zones cut along real Johor postcode geography (multiple
--    ranges per zone where the corridor is split, e.g. Skudai-Senai-Kulai
--    and Kota Tinggi + Mersing), 30 trucks (JHR-01..JHR-30) spread across
--    those zones, 6 bays, 63 customers with real-town addresses, one live
--    run per truck today with 5 ready stops each (2 already loaded), plus a
--    pending/confirmed backlog per zone -- ~190 orders total. Driver
--    accounts are created app-side (data-console server action) and mapped
--    driverN <-> JHR-N there; the SQL never sees auth user ids.
--
-- Both follow admin_seed_demo_data's rules: security definer, owner-only
-- via admin_clear_org_data's guard, deterministic _dc_uuid ids so reseeding
-- is idempotent, clear first so they always start from a blank slate.

begin;

-- ---------------------------------------------------------------------------
-- admin_seed_setup_data
-- ---------------------------------------------------------------------------
create or replace function public.admin_seed_setup_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Owner check happens inside admin_clear_org_data; call it first so the
  -- seed always starts from a blank slate and stays idempotent.
  perform public.admin_clear_org_data(p_organization_id);

  -- Catalog (same set as the demo seed) --------------------------------------
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

  -- Customers (same set as the demo seed) ------------------------------------
  insert into public.customers (id, organization_id, name, phone, address, postcode, created_by)
  select x.id, p_organization_id, x.name, x.phone, x.address, public.extract_postcode(x.address), v_actor
  from (values
    (public._dc_uuid(p_organization_id, '301'), 'Restoran Nasi Ayam Hj Salleh', '012-7011234', '12 Jalan Dhoby, 80000 Johor Bahru'),
    (public._dc_uuid(p_organization_id, '302'), 'Kedai Makan Mak Timah',        '013-7405566', '8 Jalan Molek 1/9, 81100 Johor Bahru'),
    (public._dc_uuid(p_organization_id, '303'), 'Pasar Raya Aneka Skudai',      '07-5566788',  '2 Jalan Kebudayaan 4, 81300 Skudai'),
    (public._dc_uuid(p_organization_id, '304'), 'Restoran Selera Kampung',      '011-10998877','5 Persiaran Puteri Selatan, 79100 Iskandar Puteri'),
    (public._dc_uuid(p_organization_id, '305'), 'Ayamas Frozen Mart',           '012-7223344', '31 Jalan Sutera Tanjung 8/2, 80350 Johor Bahru'),
    (public._dc_uuid(p_organization_id, '306'), 'Restoran Wan Sup Ayam',        '013-7778899', '14 Jalan Rahmat, 83000 Batu Pahat'),
    (public._dc_uuid(p_organization_id, '307'), 'Kak Ros Catering',             '019-7551122', '3 Jalan Bakri, 84000 Muar'),
    (public._dc_uuid(p_organization_id, '308'), 'Gerai Ayam Goreng Abu',        '017-7663355', '21 Jalan Besar, 83700 Yong Peng'),
    (public._dc_uuid(p_organization_id, '309'), 'Restoran Bismillah Segamat',   '012-6889900', '9 Jalan Genuang, 85000 Segamat'),
    (public._dc_uuid(p_organization_id, '30a'), 'Kluang Fresh Mart',            '018-7112233', '17 Jalan Duku, 86000 Kluang')
  ) as x(id, name, phone, address);

  perform public.link_or_create_customer_for_buyer(b.id)
  from public.buyers b
  where b.organization_id = p_organization_id
    and b.customer_id is null;

  -- Delivery setup (same set as the demo seed) -------------------------------
  insert into public.facilities (id, organization_id, name, address_line, postcode, state, created_by)
  values (public._dc_uuid(p_organization_id, '501'), p_organization_id, 'Depoh Utama',
          'Lot 8, Jalan Perindustrian Senai 3', '81400', 'Johor', v_actor);

  insert into public.bays (id, organization_id, facility_id, name, position, created_by)
  values
    (public._dc_uuid(p_organization_id, '511'), p_organization_id, public._dc_uuid(p_organization_id, '501'), 'Bay A', 0, v_actor),
    (public._dc_uuid(p_organization_id, '512'), p_organization_id, public._dc_uuid(p_organization_id, '501'), 'Bay B', 1, v_actor);

  insert into public.delivery_zones (id, organization_id, name, display_order, created_by)
  values
    (public._dc_uuid(p_organization_id, '401'), p_organization_id, 'Zone 1', 0, v_actor),
    (public._dc_uuid(p_organization_id, '402'), p_organization_id, 'Zone 2', 1, v_actor),
    (public._dc_uuid(p_organization_id, '403'), p_organization_id, 'Zone 3', 2, v_actor);

  insert into public.zone_postcode_ranges (id, organization_id, zone_id, postcode_start, postcode_end, created_by)
  values
    (public._dc_uuid(p_organization_id, '411'), p_organization_id, public._dc_uuid(p_organization_id, '401'), '79000', '82999', v_actor),
    (public._dc_uuid(p_organization_id, '412'), p_organization_id, public._dc_uuid(p_organization_id, '402'), '83000', '84999', v_actor),
    (public._dc_uuid(p_organization_id, '413'), p_organization_id, public._dc_uuid(p_organization_id, '403'), '85000', '86999', v_actor);

  insert into public.trucks (id, organization_id, name, code, bay_id, capacity_kg, created_by)
  values
    (public._dc_uuid(p_organization_id, '601'), p_organization_id, 'Truck South Zone',        'TRK-A', public._dc_uuid(p_organization_id, '511'), 800, v_actor),
    (public._dc_uuid(p_organization_id, '602'), p_organization_id, 'Truck West Coast Zone',   'TRK-B', public._dc_uuid(p_organization_id, '512'), 800, v_actor),
    (public._dc_uuid(p_organization_id, '603'), p_organization_id, 'Truck North & East Zone', 'TRK-C', null, 600, v_actor);

  insert into public.truck_zones (truck_id, zone_id, organization_id)
  values
    (public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '401'), p_organization_id),
    (public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '402'), p_organization_id),
    (public._dc_uuid(p_organization_id, '603'), public._dc_uuid(p_organization_id, '403'), p_organization_id);

  insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, created_by)
  select p_organization_id, t.id, d.weekday::smallint, '09:00'::time, '13:00'::time, v_actor
  from (values
    (public._dc_uuid(p_organization_id, '601')),
    (public._dc_uuid(p_organization_id, '602')),
    (public._dc_uuid(p_organization_id, '603'))
  ) as t(id)
  cross join generate_series(0, 6) as d(weekday);

  return jsonb_build_object(
    'products',  (select count(*) from public.products       where organization_id = p_organization_id),
    'customers', (select count(*) from public.customers      where organization_id = p_organization_id),
    'zones',     (select count(*) from public.delivery_zones where organization_id = p_organization_id),
    'trucks',    (select count(*) from public.trucks         where organization_id = p_organization_id)
  );
end;
$$;

revoke all on function public.admin_seed_setup_data(uuid) from public;
grant execute on function public.admin_seed_setup_data(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_seed_realworld_data
-- ---------------------------------------------------------------------------
create or replace function public.admin_seed_realworld_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  perform public.admin_clear_org_data(p_organization_id);

  -- Catalog: identical to the demo seed so product screens look the same.
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

  -- Depot + bays -------------------------------------------------------------
  insert into public.facilities (id, organization_id, name, address_line, postcode, state, created_by)
  values (public._dc_uuid(p_organization_id, '501'), p_organization_id, 'Depoh Utama Senai',
          'Lot 8, Jalan Perindustrian Senai 3', '81400', 'Johor', v_actor);

  insert into public.bays (id, organization_id, facility_id, name, position, created_by)
  select public._dc_uuid(p_organization_id, 'bay' || b.n), p_organization_id,
         public._dc_uuid(p_organization_id, '501'), 'Bay ' || chr(64 + b.n), b.n - 1, v_actor
  from generate_series(1, 6) as b(n);

  -- Zones: real Johor postcode geography. Multiple ranges where a zone's
  -- corridor is split by another town's block (Skudai-Senai-Kulai wraps
  -- around JB Utara's 811xx; Mersing rides with Kota Tinggi).
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

  -- Trucks: 30 across the zones, sized by how dense the zone is. The truck
  -- number doubles as the driver mapping: the console action puts
  -- driver<N>@gmail.com on JHR-<N>'s run.
  drop table if exists _rw_trucks;
  create temp table _rw_trucks on commit drop as
  select * from (values
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

  insert into public.trucks (id, organization_id, name, code, bay_id, capacity_kg, created_by)
  select public._dc_uuid(p_organization_id, 'trk-' || t.n), p_organization_id, t.name,
         'JHR-' || lpad(t.n::text, 2, '0'),
         public._dc_uuid(p_organization_id, 'bay' || (((t.n - 1) % 6) + 1)),
         t.capacity, v_actor
  from _rw_trucks t;

  insert into public.truck_zones (truck_id, zone_id, organization_id)
  select public._dc_uuid(p_organization_id, 'trk-' || t.n),
         public._dc_uuid(p_organization_id, t.zone), p_organization_id
  from _rw_trucks t;

  -- Morning + afternoon slot per truck per weekday.
  insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, created_by)
  select p_organization_id, public._dc_uuid(p_organization_id, 'trk-' || t.n),
         d.weekday::smallint, s.st::time, s.et::time, v_actor
  from _rw_trucks t
  cross join generate_series(0, 6) as d(weekday)
  cross join (values ('09:00', '13:00'), ('14:00', '18:00')) as s(st, et);

  -- Customers: 3 shops per town, 21 real Johor towns with correct postcodes,
  -- so postcode -> zone resolution behaves exactly like production traffic.
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

  -- Runs: one live run today per truck. The console action assigns
  -- driver<N> to JHR-<N> right after this returns.
  insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
  select public._dc_uuid(p_organization_id, 'run-' || t.n), p_organization_id,
         public._dc_uuid(p_organization_id, 'trk-' || t.n), v_today, 'planned'
  from _rw_trucks t;

  -- Ready orders: 5 stops per truck today (150 total), first 2 loaded.
  -- Customers rotate through the truck's own zone, offset per truck so two
  -- trucks in one zone do not serve identical customer lists.
  -- run_sequence comes from the BEFORE INSERT trigger in insertion order, so
  -- ORDER BY truck, stop below fixes the stop sequence.
  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    assignment_source, loaded_at, loaded_by
  )
  select
    public._dc_uuid(p_organization_id, 'ro-' || t.n || '-' || s.s),
    p_organization_id, c.id, v_actor, 'manual', 'ready',
    public._dc_uuid(p_organization_id, t.zone),
    c.address, c.postcode, v_today,
    (select sl.id from public.delivery_slots sl
      where sl.organization_id = p_organization_id
        and sl.truck_id = public._dc_uuid(p_organization_id, 'trk-' || t.n)
        and sl.weekday = extract(dow from v_today)::smallint
        and sl.start_time = '09:00'::time limit 1),
    public._dc_uuid(p_organization_id, 'trk-' || t.n),
    public._dc_uuid(p_organization_id, 'run-' || t.n),
    'auto',
    case when s.s <= 2 then now() - interval '2 hours' end,
    case when s.s <= 2 then v_actor end
  from _rw_trucks t
  cross join generate_series(1, 5) as s(s)
  -- stride 1 through the zone's customers (offset by truck) so all 5 stops
  -- hit 5 distinct shops; a stride sharing a factor with the zone size (6 or
  -- 9) would fold onto 2-3 shops with duplicate stops per run.
  join _rw_cust c
    on c.zone = t.zone
   and c.zone_seq = ((t.n * 2 + s.s)
         % (select count(*) from _rw_cust c2 where c2.zone = t.zone)) + 1
  order by t.n, s.s;

  -- Backlog per zone, dated tomorrow on the zone's first truck: 2 pending
  -- (raw requests) + 1 confirmed with the weigh task still open (40 total).
  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    assignment_source
  )
  select
    public._dc_uuid(p_organization_id, b.kind || '-' || z.zone || '-' || b.n),
    p_organization_id, c.id, v_actor, 'manual', b.status::public.order_status,
    public._dc_uuid(p_organization_id, z.zone),
    c.address, c.postcode, v_today + 1,
    (select sl.id from public.delivery_slots sl
      where sl.organization_id = p_organization_id
        and sl.truck_id = public._dc_uuid(p_organization_id, 'trk-' || z.first_truck)
        and sl.weekday = extract(dow from v_today + 1)::smallint
        and sl.start_time = '09:00'::time limit 1),
    public._dc_uuid(p_organization_id, 'trk-' || z.first_truck),
    null, 'none'
  from (
    select t.zone, min(t.n) as first_truck from _rw_trucks t group by t.zone
  ) z
  cross join (values ('po', 1, 'pending'), ('po', 2, 'pending'), ('co', 3, 'confirmed')) as b(kind, n, status)
  join _rw_cust c
    on c.zone = z.zone
   and c.zone_seq = ((z.first_truck + b.n * 5)
         % (select count(*) from _rw_cust c2 where c2.zone = z.zone)) + 1;

  -- Items. Ready stops: line 1 whole birds (weighed + priced), line 2 on
  -- every other stop a cut by kg. Deal prices mirror the demo seed.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, price_per_kg
  )
  select
    public._dc_uuid(p_organization_id, 'ri-' || t.n || '-' || s.s || '-1'),
    public._dc_uuid(p_organization_id, 'ro-' || t.n || '-' || s.s),
    public._dc_uuid(p_organization_id,
      case (t.n + s.s) % 3 when 0 then '101' when 1 then '102' else '103' end),
    'piece', (4 + ((t.n * 7 + s.s * 3) % 9))::numeric, 1.2, 1.8, 'mix',
    round(((4 + ((t.n * 7 + s.s * 3) % 9)) * (1.3 + ((t.n + s.s) % 5) * 0.1))::numeric, 1),
    case (t.n + s.s) % 3 when 0 then 9.50 when 1 then 16.00 else 8.00 end
  from _rw_trucks t cross join generate_series(1, 5) as s(s);

  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, price_per_kg
  )
  select
    public._dc_uuid(p_organization_id, 'ri-' || t.n || '-' || s.s || '-2'),
    public._dc_uuid(p_organization_id, 'ro-' || t.n || '-' || s.s),
    public._dc_uuid(p_organization_id,
      (array['104','105','106','107','108','109','10a','10b','10c','10d'])[((t.n * 3 + s.s) % 10) + 1]),
    'kg', (2 + ((t.n * 5 + s.s * 7) % 8))::numeric, 0.2, 0.5, 'mix',
    (2 + ((t.n * 5 + s.s * 7) % 8))::numeric + 0.2,
    (array[13.50, 13.00, 12.50, 16.50, 15.50, 6.50, 7.00, 8.50, 4.50, 9.00]::numeric[])[((t.n * 3 + s.s) % 10) + 1]
  from _rw_trucks t cross join generate_series(1, 5) as s(s)
  where (t.n + s.s) % 2 = 0;

  -- Backlog items: pending lines are raw requests, confirmed lines carry
  -- the confirm price but no weight yet.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, price_per_kg
  )
  select
    public._dc_uuid(p_organization_id, 'bi-' || z.zone || '-' || b.n),
    public._dc_uuid(p_organization_id, b.kind || '-' || z.zone || '-' || b.n),
    public._dc_uuid(p_organization_id,
      case (z.first_truck + b.n) % 3 when 0 then '101' when 1 then '102' else '104' end),
    case when (z.first_truck + b.n) % 3 = 2 then 'kg' else 'piece' end::public.order_item_mode,
    (3 + ((z.first_truck + b.n * 5) % 10))::numeric, 1.1, 1.7, 'mix',
    case when b.status = 'confirmed'
      then (case (z.first_truck + b.n) % 3 when 0 then 9.50 when 1 then 16.00 else 13.50 end)
    end
  from (
    select t.zone, min(t.n) as first_truck from _rw_trucks t group by t.zone
  ) z
  cross join (values ('po', 1, 'pending'), ('po', 2, 'pending'), ('co', 3, 'confirmed')) as b(kind, n, status);

  -- Tasks: done for every ready stop, open for the confirmed backlog.
  insert into public.order_tasks (organization_id, order_id, type, status, done_by, done_at)
  select p_organization_id, public._dc_uuid(p_organization_id, 'ro-' || t.n || '-' || s.s),
         'allocate_weigh', 'done', v_actor, now() - interval '5 hours'
  from _rw_trucks t cross join generate_series(1, 5) as s(s);

  insert into public.order_tasks (organization_id, order_id, type, status)
  select p_organization_id, public._dc_uuid(p_organization_id, 'co-' || z.zone || '-3'),
         'allocate_weigh', 'pending'
  from (select distinct t.zone from _rw_trucks t) z;

  -- Warehouse weight log per weighed line, matching what the RPCs leave.
  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by)
  select p_organization_id, i.id, 'warehouse', i.warehouse_weight_kg, v_actor
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.organization_id = p_organization_id and i.warehouse_weight_kg is not null;

  return jsonb_build_object(
    'products',  (select count(*) from public.products       where organization_id = p_organization_id),
    'customers', (select count(*) from public.customers      where organization_id = p_organization_id),
    'zones',     (select count(*) from public.delivery_zones where organization_id = p_organization_id),
    'trucks',    (select count(*) from public.trucks         where organization_id = p_organization_id),
    'orders',    (select count(*) from public.orders         where organization_id = p_organization_id),
    'runs',      (select count(*) from public.delivery_runs  where organization_id = p_organization_id)
  );
end;
$$;

revoke all on function public.admin_seed_realworld_data(uuid) from public;
grant execute on function public.admin_seed_realworld_data(uuid) to authenticated;

commit;
