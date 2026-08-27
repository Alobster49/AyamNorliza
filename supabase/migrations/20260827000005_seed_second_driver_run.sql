-- 20260827000005_seed_second_driver_run.sql
-- A second live run today, on a second truck, so driver2 also has stops.
--
-- Until now the seed produced exactly one non-completed run (run A on
-- TRK-A), so the office round-robin in seedDemoData (data-console server
-- action) always handed it to driver1 and left driver2's deck empty --
-- deliberate at the time (see accounts.ts), but it means nothing exercises
-- two drivers working concurrently: real-time updates between decks, two
-- trucks departing independently, dispatch showing both in flight at once.
--
-- Adds Run C: today, TRK-B (Zone 2), 3 ready stops (2 loaded), same shape as
-- Run A. The round-robin already assigns every non-completed run across all
-- seeded drivers in run_date order, so with two live runs today driver1 and
-- driver2 each land one -- no app-code change needed.
--
-- New counts: orders 64 -> 67 (+3), runs 23 -> 24 (+1). Products/customers
-- unchanged.

begin;

create or replace function public.admin_seed_demo_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  -- Owner check happens inside admin_clear_org_data; call it first so the
  -- seed always starts from a blank slate and stays idempotent.
  perform public.admin_clear_org_data(p_organization_id);

  -- Catalog ------------------------------------------------------------------
  -- Two categories, the way the counter sells: whole birds vs cuts.
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

  -- Customers ----------------------------------------------------------------
  -- postcode is derived from the embedded address here (state/area cannot
  -- be resolved from SQL alone -- see 20260823000009).
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

  -- Relink existing buyer accounts through the shared signup-link logic
  -- (oldest-unclaimed-phone-match-wins, no stealing) instead of a blanket
  -- insert+update, so admin-seeded orgs behave like organic signups.
  perform public.link_or_create_customer_for_buyer(b.id)
  from public.buyers b
  where b.organization_id = p_organization_id
    and b.customer_id is null;

  -- Logistics setup (matches the delivery setup console) ---------------------
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

  -- One 09:00-13:00 slot per truck per weekday, so any delivery date works.
  insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, created_by)
  select p_organization_id, t.id, d.weekday::smallint, '09:00'::time, '13:00'::time, v_actor
  from (values
    (public._dc_uuid(p_organization_id, '601')),
    (public._dc_uuid(p_organization_id, '602')),
    (public._dc_uuid(p_organization_id, '603'))
  ) as t(id)
  cross join generate_series(0, 6) as d(weekday);

  -- Runs ---------------------------------------------------------------------
  -- Run A: today, TRK-A, being loaded (-> driver1). Run B: yesterday, TRK-B,
  -- completed. Run C: today, TRK-B, being loaded (-> driver2) -- two live
  -- runs on the same day so both seeded drivers have a deck to work.
  insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
  values
    (public._dc_uuid(p_organization_id, '701'), p_organization_id, public._dc_uuid(p_organization_id, '601'), v_today, 'planned'),
    (public._dc_uuid(p_organization_id, '702'), p_organization_id, public._dc_uuid(p_organization_id, '602'), v_today - 1, 'completed'),
    (public._dc_uuid(p_organization_id, '703'), p_organization_id, public._dc_uuid(p_organization_id, '602'), v_today, 'planned');

  -- Orders -------------------------------------------------------------------
  -- 4 pending, 2 confirmed w/ open task, 1 confirmed weighed, 4 ready on run
  -- A (2 loaded), 3 ready on run C (2 loaded), and on run B: 2 driver-settled
  -- (closed) + 1 office-swept (delivered, unsettled), 1 cancelled = 18.
  -- run_sequence is not set here: the orders_set_run_sequence_trg BEFORE
  -- INSERT trigger assigns it in insertion order, so the VALUES row order of
  -- run-assigned orders below is what determines stop sequence.
  -- total_amount is left at 0 and recomputed from line_total after the items
  -- go in, exactly like driver_deliver_stop does.
  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    assignment_source, loaded_at, loaded_by, closed_at
  )
  select
    o.id, p_organization_id, o.customer_id, v_actor, 'manual', o.status::public.order_status,
    o.zone_id,
    (select address from public.customers c where c.id = o.customer_id),
    o.postcode, v_today + o.date_offset,
    (select s.id from public.delivery_slots s
      where s.organization_id = p_organization_id and s.truck_id = o.truck_id
        and s.weekday = extract(dow from v_today + o.date_offset)::smallint limit 1),
    o.truck_id, o.run_id,
    (case when o.run_id is null then 'none' else 'auto' end)::public.assignment_source,
    case when o.status in ('delivered', 'closed') then now() - interval '26 hours'
         when o.loaded then now() - interval '2 hours' end,
    case when o.status in ('delivered', 'closed') or o.loaded then v_actor end,
    case when o.status = 'closed' then now() - interval '20 hours' end
  from (values
    -- pending
    (public._dc_uuid(p_organization_id, '801'), public._dc_uuid(p_organization_id, '301'), 'pending',   public._dc_uuid(p_organization_id, '401'), '80000', 1, public._dc_uuid(p_organization_id, '601'), null::uuid, false),
    (public._dc_uuid(p_organization_id, '802'), public._dc_uuid(p_organization_id, '302'), 'pending',   public._dc_uuid(p_organization_id, '401'), '81100', 1, public._dc_uuid(p_organization_id, '601'), null, false),
    (public._dc_uuid(p_organization_id, '803'), public._dc_uuid(p_organization_id, '306'), 'pending',   public._dc_uuid(p_organization_id, '402'), '83000', 2, public._dc_uuid(p_organization_id, '602'), null, false),
    (public._dc_uuid(p_organization_id, '804'), public._dc_uuid(p_organization_id, '309'), 'pending',   public._dc_uuid(p_organization_id, '403'), '85000', 3, public._dc_uuid(p_organization_id, '603'), null, false),
    -- confirmed, task open
    (public._dc_uuid(p_organization_id, '805'), public._dc_uuid(p_organization_id, '303'), 'confirmed', public._dc_uuid(p_organization_id, '401'), '81300', 1, public._dc_uuid(p_organization_id, '601'), null, false),
    (public._dc_uuid(p_organization_id, '806'), public._dc_uuid(p_organization_id, '307'), 'confirmed', public._dc_uuid(p_organization_id, '402'), '84000', 2, public._dc_uuid(p_organization_id, '602'), null, false),
    -- confirmed, warehouse weighed (task done)
    (public._dc_uuid(p_organization_id, '807'), public._dc_uuid(p_organization_id, '304'), 'confirmed', public._dc_uuid(p_organization_id, '401'), '79100', 1, public._dc_uuid(p_organization_id, '601'), null, false),
    -- ready on run A (today, TRK-A); first two already loaded
    (public._dc_uuid(p_organization_id, '808'), public._dc_uuid(p_organization_id, '301'), 'ready',     public._dc_uuid(p_organization_id, '401'), '80000', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), true),
    (public._dc_uuid(p_organization_id, '809'), public._dc_uuid(p_organization_id, '302'), 'ready',     public._dc_uuid(p_organization_id, '401'), '81100', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), true),
    (public._dc_uuid(p_organization_id, '80a'), public._dc_uuid(p_organization_id, '303'), 'ready',     public._dc_uuid(p_organization_id, '401'), '81300', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), false),
    (public._dc_uuid(p_organization_id, '80b'), public._dc_uuid(p_organization_id, '305'), 'ready',     public._dc_uuid(p_organization_id, '401'), '80350', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), false),
    -- run B (yesterday, TRK-B): two stops the driver settled at the door
    (public._dc_uuid(p_organization_id, '80c'), public._dc_uuid(p_organization_id, '306'), 'closed',    public._dc_uuid(p_organization_id, '402'), '83000', -1, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '702'), false),
    (public._dc_uuid(p_organization_id, '80d'), public._dc_uuid(p_organization_id, '307'), 'closed',    public._dc_uuid(p_organization_id, '402'), '84000', -1, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '702'), false),
    -- ... and one the office swept to delivered: no final weights recorded,
    -- so it waits in the settlement queue.
    (public._dc_uuid(p_organization_id, '80e'), public._dc_uuid(p_organization_id, '308'), 'delivered', public._dc_uuid(p_organization_id, '402'), '83700', -1, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '702'), false),
    -- cancelled
    (public._dc_uuid(p_organization_id, '80f'), public._dc_uuid(p_organization_id, '30a'), 'cancelled', public._dc_uuid(p_organization_id, '403'), '86000', 2, public._dc_uuid(p_organization_id, '603'), null, false),
    -- ready on run C (today, TRK-B); first two already loaded -- driver2's deck
    (public._dc_uuid(p_organization_id, '812'), public._dc_uuid(p_organization_id, '306'), 'ready',     public._dc_uuid(p_organization_id, '402'), '83000', 0, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '703'), true),
    (public._dc_uuid(p_organization_id, '813'), public._dc_uuid(p_organization_id, '307'), 'ready',     public._dc_uuid(p_organization_id, '402'), '84000', 0, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '703'), true),
    (public._dc_uuid(p_organization_id, '814'), public._dc_uuid(p_organization_id, '308'), 'ready',     public._dc_uuid(p_organization_id, '402'), '83700', 0, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '703'), false)
  ) as o(id, customer_id, status, zone_id, postcode, date_offset, truck_id, run_id, loaded);

  -- Order items --------------------------------------------------------------
  -- Since price-at-confirm, every line past 'pending' carries the deal price
  -- (RM/kg -- piece lines are billed by weight too). Deal prices used here:
  -- pedaging 9.50, kampung 16.00, tua 8.00, dada 13.50, peha 13.00,
  -- pangkal peha 12.50, kepak 16.50, wing 15.50, kaki 6.50, leher 7.00,
  -- hati 8.50, rangka 4.50, cop 9.00.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, final_weight_kg, final_pieces, price_per_kg
  )
  select x.id, x.order_id, x.product_id, x.mode::public.order_item_mode, x.qty,
         x.smin, x.smax, 'mix'::public.order_fallback, x.wkg, x.fkg, x.fpc, x.price
  from (values
    -- pending orders: raw requests only, no price yet
    (public._dc_uuid(p_organization_id, '901'), public._dc_uuid(p_organization_id, '801'), public._dc_uuid(p_organization_id, '101'), 'piece', 10::numeric, 1.3::numeric, 1.6::numeric, null::numeric, null::numeric, null::integer, null::numeric),
    (public._dc_uuid(p_organization_id, '902'), public._dc_uuid(p_organization_id, '801'), public._dc_uuid(p_organization_id, '104'), 'kg',     5, 0.3, 0.5, null, null, null, null),
    (public._dc_uuid(p_organization_id, '903'), public._dc_uuid(p_organization_id, '802'), public._dc_uuid(p_organization_id, '102'), 'piece',  4, 1.1, 1.4, null, null, null, null),
    (public._dc_uuid(p_organization_id, '904'), public._dc_uuid(p_organization_id, '803'), public._dc_uuid(p_organization_id, '105'), 'kg',     8, 0.2, 0.4, null, null, null, null),
    (public._dc_uuid(p_organization_id, '905'), public._dc_uuid(p_organization_id, '804'), public._dc_uuid(p_organization_id, '107'), 'kg',     6, 0.1, 0.3, null, null, null, null),
    -- confirmed, task open: priced at confirm
    (public._dc_uuid(p_organization_id, '906'), public._dc_uuid(p_organization_id, '805'), public._dc_uuid(p_organization_id, '101'), 'piece', 20, 1.4, 1.8, null, null, null,  9.50),
    (public._dc_uuid(p_organization_id, '907'), public._dc_uuid(p_organization_id, '806'), public._dc_uuid(p_organization_id, '10b'), 'kg',     3, 0.1, 0.2, null, null, null,  8.50),
    -- confirmed, warehouse weighed
    (public._dc_uuid(p_organization_id, '908'), public._dc_uuid(p_organization_id, '807'), public._dc_uuid(p_organization_id, '101'), 'piece', 15, 1.3, 1.7, 23.4, null, null,  9.50),
    -- ready on run A: warehouse weighed
    (public._dc_uuid(p_organization_id, '909'), public._dc_uuid(p_organization_id, '808'), public._dc_uuid(p_organization_id, '101'), 'piece', 12, 1.3, 1.6, 17.8, null, null,  9.50),
    (public._dc_uuid(p_organization_id, '90a'), public._dc_uuid(p_organization_id, '808'), public._dc_uuid(p_organization_id, '109'), 'kg',     4, 0.1, 0.2,  4.1, null, null,  6.50),
    (public._dc_uuid(p_organization_id, '90b'), public._dc_uuid(p_organization_id, '809'), public._dc_uuid(p_organization_id, '106'), 'kg',    10, 0.2, 0.4, 10.3, null, null, 12.50),
    (public._dc_uuid(p_organization_id, '90c'), public._dc_uuid(p_organization_id, '80a'), public._dc_uuid(p_organization_id, '104'), 'kg',     6, 0.3, 0.5,  6.2, null, null, 13.50),
    (public._dc_uuid(p_organization_id, '90d'), public._dc_uuid(p_organization_id, '80b'), public._dc_uuid(p_organization_id, '10c'), 'kg',    12, 0.5, 0.9, 12.6, null, null,  4.50),
    -- run B, driver-settled: door weights are the billed truth
    (public._dc_uuid(p_organization_id, '90e'), public._dc_uuid(p_organization_id, '80c'), public._dc_uuid(p_organization_id, '101'), 'piece', 10, 1.4, 1.8, 16.5, 16.0,   10,  9.50),
    (public._dc_uuid(p_organization_id, '90f'), public._dc_uuid(p_organization_id, '80d'), public._dc_uuid(p_organization_id, '105'), 'kg',     7, 0.2, 0.4,  7.6,  7.5, null, 13.00),
    -- run B, office-swept: warehouse weight only, waits for settlement
    (public._dc_uuid(p_organization_id, '910'), public._dc_uuid(p_organization_id, '80e'), public._dc_uuid(p_organization_id, '107'), 'kg',     9, 0.1, 0.3,  8.8, null, null, 16.50),
    -- cancelled before confirm: never priced
    (public._dc_uuid(p_organization_id, '911'), public._dc_uuid(p_organization_id, '80f'), public._dc_uuid(p_organization_id, '103'), 'piece',  5, 1.0, 1.4, null, null, null, null),
    -- ready on run C: warehouse weighed -- driver2's deck
    (public._dc_uuid(p_organization_id, '912'), public._dc_uuid(p_organization_id, '812'), public._dc_uuid(p_organization_id, '102'), 'piece',  4, 1.1, 1.4,  4.6, null, null, 16.00),
    (public._dc_uuid(p_organization_id, '913'), public._dc_uuid(p_organization_id, '813'), public._dc_uuid(p_organization_id, '105'), 'kg',     7, 0.2, 0.4,  2.3, null, null, 13.00),
    (public._dc_uuid(p_organization_id, '914'), public._dc_uuid(p_organization_id, '814'), public._dc_uuid(p_organization_id, '108'), 'kg',     9, 0.1, 0.3,  2.6, null, null, 15.50)
  ) as x(id, order_id, product_id, mode, qty, smin, smax, wkg, fkg, fpc, price);

  -- Tasks: open for 805/806, done for the weighed/ready/run-B/run-C orders.
  insert into public.order_tasks (organization_id, order_id, type, status, done_by, done_at)
  select p_organization_id, x.order_id, 'allocate_weigh', x.status::public.order_task_status,
         case when x.status = 'done' then v_actor end,
         case when x.status = 'done' then now() - interval '5 hours' end
  from (values
    (public._dc_uuid(p_organization_id, '805'), 'pending'),
    (public._dc_uuid(p_organization_id, '806'), 'pending'),
    (public._dc_uuid(p_organization_id, '807'), 'done'),
    (public._dc_uuid(p_organization_id, '808'), 'done'),
    (public._dc_uuid(p_organization_id, '809'), 'done'),
    (public._dc_uuid(p_organization_id, '80a'), 'done'),
    (public._dc_uuid(p_organization_id, '80b'), 'done'),
    (public._dc_uuid(p_organization_id, '80c'), 'done'),
    (public._dc_uuid(p_organization_id, '80d'), 'done'),
    (public._dc_uuid(p_organization_id, '80e'), 'done'),
    (public._dc_uuid(p_organization_id, '812'), 'done'),
    (public._dc_uuid(p_organization_id, '813'), 'done'),
    (public._dc_uuid(p_organization_id, '814'), 'done')
  ) as x(order_id, status);

  -- History ------------------------------------------------------------------
  -- Three weeks of settled business behind the live pipeline, so dashboards,
  -- reports and invoices open on real-looking numbers. One completed run per
  -- day for offsets 2..22; the truck rotates by day (d%3: 0=TRK-A/Zone 1 with
  -- 3 stops, 1=TRK-B/Zone 2 with 2, 2=TRK-C/Zone 3 with 2), customers rotate
  -- within the truck's zone. Every stop was driver-settled at the door:
  -- status 'closed', final weights + pieces, weight logs, arrive/leave marks
  -- and a delivered attempt. All quantities derive from the day offset, so
  -- the data is deterministic and reseeding is idempotent.
  insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
  select public._dc_uuid(p_organization_id, 'hr-' || d.d), p_organization_id,
         public._dc_uuid(p_organization_id,
           case d.d % 3 when 0 then '601' when 1 then '602' else '603' end),
         v_today - d.d, 'completed'
  from generate_series(2, 22) as d(d);

  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    assignment_source, loaded_at, loaded_by, closed_at, created_at
  )
  select
    public._dc_uuid(p_organization_id, 'ho-' || x.d || '-' || x.n),
    p_organization_id, x.customer_id, v_actor, 'manual', 'closed', x.zone_id,
    c.address, c.postcode, v_today - x.d,
    (select s.id from public.delivery_slots s
      where s.organization_id = p_organization_id and s.truck_id = x.truck_id
        and s.weekday = extract(dow from v_today - x.d)::smallint limit 1),
    x.truck_id,
    public._dc_uuid(p_organization_id, 'hr-' || x.d),
    'auto',
    x.closed_ts - interval '4 hours', v_actor,
    x.closed_ts,
    x.closed_ts - interval '27 hours'
  from (
    select d.d, n.n,
           public._dc_uuid(p_organization_id,
             case d.d % 3 when 0 then '601' when 1 then '602' else '603' end) as truck_id,
           public._dc_uuid(p_organization_id,
             case d.d % 3 when 0 then '401' when 1 then '402' else '403' end) as zone_id,
           public._dc_uuid(p_organization_id,
             case d.d % 3
               when 0 then (array['301','302','303','304','305'])[((d.d + n.n) % 5) + 1]
               when 1 then (array['306','307','308'])[((d.d + n.n) % 3) + 1]
               else        (array['309','30a'])[((d.d + n.n) % 2) + 1]
             end) as customer_id,
           (((v_today - d.d) + time '13:30') at time zone 'Asia/Kuala_Lumpur')
             + n.n * interval '25 minutes' as closed_ts
    from generate_series(2, 22) as d(d)
    cross join generate_series(1, 3) as n(n)
    where n.n <= case when d.d % 3 = 0 then 3 else 2 end
  ) x
  join public.customers c on c.id = x.customer_id;

  -- History line 1: whole birds by piece, billed by door weight.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, final_weight_kg, final_pieces, price_per_kg
  )
  select
    public._dc_uuid(p_organization_id, 'hi-' || x.d || '-' || x.n || '-1'),
    public._dc_uuid(p_organization_id, 'ho-' || x.d || '-' || x.n),
    public._dc_uuid(p_organization_id,
      case (x.d + x.n) % 3 when 0 then '101' when 1 then '102' else '103' end),
    'piece', x.pieces, 1.2, 1.8, 'mix',
    x.fkg + 0.4, x.fkg, x.pieces::integer,
    case (x.d + x.n) % 3 when 0 then 9.50 when 1 then 16.00 else 8.00 end
  from (
    select d.d, n.n,
           (6 + ((d.d * 7 + n.n * 3) % 9))::numeric as pieces,
           round(((6 + ((d.d * 7 + n.n * 3) % 9))
             * (1.3 + ((d.d * 3 + n.n) % 5) * 0.1))::numeric, 1) as fkg
    from generate_series(2, 22) as d(d)
    cross join generate_series(1, 3) as n(n)
    where n.n <= case when d.d % 3 = 0 then 3 else 2 end
  ) x;

  -- History line 2 (every other order): a cut, ordered and billed by kg.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, final_weight_kg, final_pieces, price_per_kg
  )
  select
    public._dc_uuid(p_organization_id, 'hi-' || x.d || '-' || x.n || '-2'),
    public._dc_uuid(p_organization_id, 'ho-' || x.d || '-' || x.n),
    public._dc_uuid(p_organization_id,
      (array['104','105','106','107','108','109','10a','10b','10c','10d'])[((x.d * 3 + x.n) % 10) + 1]),
    'kg', x.qty, 0.2, 0.5, 'mix',
    x.fkg + 0.2, x.fkg, null,
    (array[13.50, 13.00, 12.50, 16.50, 15.50, 6.50, 7.00, 8.50, 4.50, 9.00]::numeric[])[((x.d * 3 + x.n) % 10) + 1]
  from (
    select d.d, n.n,
           (3 + ((d.d * 5 + n.n * 7) % 8))::numeric as qty,
           ((3 + ((d.d * 5 + n.n * 7) % 8)) + (((d.d + n.n) % 5) - 2) * 0.1)::numeric as fkg
    from generate_series(2, 22) as d(d)
    cross join generate_series(1, 3) as n(n)
    where n.n <= case when d.d % 3 = 0 then 3 else 2 end
      and (d.d + n.n) % 2 = 0
  ) x;

  -- Warehouse tasks for the settled history: confirmed -> allocated & weighed.
  insert into public.order_tasks (organization_id, order_id, type, status, done_by, done_at)
  select p_organization_id, o.id, 'allocate_weigh', 'done', v_actor, o.closed_at - interval '6 hours'
  from public.orders o
  where o.organization_id = p_organization_id and o.status = 'closed'
    and not exists (select 1 from public.order_tasks t where t.order_id = o.id);

  -- Settled totals: recompute from line_total exactly like driver_deliver_stop.
  update public.orders o
  set total_amount = t.total
  from (
    select i.order_id, coalesce(sum(i.line_total), 0) as total
    from public.order_items i
    join public.orders oo on oo.id = i.order_id
    where oo.organization_id = p_organization_id and oo.status = 'closed'
      and i.is_cancelled = false
    group by i.order_id
  ) t
  where o.id = t.order_id;

  -- Weight log: a 'warehouse' row per weighed line, a 'final' row per
  -- door-weighed line -- the same trail the RPCs leave.
  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by)
  select p_organization_id, i.id, 'warehouse', i.warehouse_weight_kg, v_actor
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.organization_id = p_organization_id and i.warehouse_weight_kg is not null;

  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
  select p_organization_id, i.id, 'final', i.final_weight_kg, i.final_pieces, v_actor
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.organization_id = p_organization_id and i.final_weight_kg is not null;

  -- Stop history for every driver-settled order: arrive, then the leave mark
  -- driver_deliver_stop writes at settlement time.
  insert into public.run_stop_events (organization_id, run_id, order_id, kind, at, recorded_by)
  select p_organization_id, o.run_id, o.id, k.kind::public.stop_event_kind,
         o.closed_at + k.offset_min * interval '1 minute', v_actor
  from public.orders o
  cross join (values ('arrive', -12), ('leave', 0)) as k(kind, offset_min)
  where o.organization_id = p_organization_id and o.status = 'closed';

  -- The office-swept order still shows the driver passing through the stop,
  -- but no delivery attempt was recorded -- that is why it needs settling.
  insert into public.run_stop_events (organization_id, run_id, order_id, kind, at, recorded_by)
  values
    (p_organization_id, public._dc_uuid(p_organization_id, '702'), public._dc_uuid(p_organization_id, '80e'),
     'arrive', now() - interval '20 hours 30 minutes', v_actor),
    (p_organization_id, public._dc_uuid(p_organization_id, '702'), public._dc_uuid(p_organization_id, '80e'),
     'leave',  now() - interval '20 hours 15 minutes', v_actor);

  -- A delivered attempt per settled stop; every other stop paid cash in full.
  insert into public.delivery_attempts (
    organization_id, run_id, order_id, outcome, received_by, cash_collected,
    attempted_at, recorded_by
  )
  select p_organization_id, o.run_id, o.id, 'delivered',
         (array['Wan', 'Kak Ros', 'Abu', 'Salleh', 'Mak Timah', 'Ana', 'Mail'])[(coalesce(o.run_sequence, 1) % 7) + 1],
         case when coalesce(o.run_sequence, 1) % 2 = 1 then o.total_amount end,
         o.closed_at, v_actor
  from public.orders o
  where o.organization_id = p_organization_id and o.status = 'closed';

  return jsonb_build_object(
    'products',  (select count(*) from public.products  where organization_id = p_organization_id),
    'customers', (select count(*) from public.customers where organization_id = p_organization_id),
    'orders',    (select count(*) from public.orders    where organization_id = p_organization_id),
    'runs',      (select count(*) from public.delivery_runs where organization_id = p_organization_id)
  );
end;
$$;

revoke all on function public.admin_seed_demo_data(uuid) from public;
grant execute on function public.admin_seed_demo_data(uuid) to authenticated;

commit;
