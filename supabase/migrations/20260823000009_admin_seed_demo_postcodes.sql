-- 20260823000009_admin_seed_demo_postcodes.sql
-- admin_seed_demo_data (20260823000007, already merged) inserts ten demo
-- customers whose free-text address carries an embedded postcode but never
-- populates the new customers.postcode column added by
-- 20260823000008_customer_structured_address.sql. Those rows are created
-- after that migration's one-time backfill runs, so they never get a
-- postcode: the manual order screen can't resolve a delivery zone for them,
-- and opening any demo customer's Edit dialog and changing so much as the
-- name throws the "Enter a 5-digit postcode for this address" validation
-- error, because parseCustomerAddress requires a postcode whenever an
-- address is present.
--
-- Full re-definition (same signature, security definer, search_path, grants
-- as 20260823000007) with the customers insert changed to also derive
-- postcode via extract_postcode(). state/area are left null: SQL can't
-- resolve them (extract_postcode only reads the address string, not the
-- vendored postcode dataset), and the pairing constraint added in
-- 20260823000008 permits a postcode with both state and area null.

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
  insert into public.categories (id, organization_id, name, description, created_by)
  values (public._dc_uuid(p_organization_id, 'c001'), p_organization_id, 'Ayam Segar',
          'Fresh chicken, whole birds and cuts', v_actor);

  insert into public.products (id, organization_id, category_id, name, image_url, created_by)
  select x.id, p_organization_id, public._dc_uuid(p_organization_id, 'c001'), x.name, x.image_url, v_actor
  from (values
    (public._dc_uuid(p_organization_id, '101'), 'Ayam Pedaging Seekor (Standard)', '/product/ayam-pedaging.jpg'),
    (public._dc_uuid(p_organization_id, '102'), 'Ayam Kampung Seekor',             '/product/ayam-kampung.jpg'),
    (public._dc_uuid(p_organization_id, '103'), 'Ayam Tua / Penelur Seekor',       '/product/ayam-tua.jpg'),
    (public._dc_uuid(p_organization_id, '104'), 'Dada Ayam',                       '/product/dada-ayam.png'),
    (public._dc_uuid(p_organization_id, '105'), 'Peha Ayam',                       '/product/peha-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '106'), 'Pangkal Peha',                    '/product/pangkal-peha.jpg'),
    (public._dc_uuid(p_organization_id, '107'), 'Kepak Ayam',                      '/product/kepak-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '108'), 'Chicken Wing (3-Joint)',          '/product/chicken-wing.jpg'),
    (public._dc_uuid(p_organization_id, '109'), 'Kaki Ayam',                       '/product/kaki-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10a'), 'Leher Ayam',                      '/product/leher-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10b'), 'Hati Ayam',                       '/product/hati-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10c'), 'Rangka Ayam',                     '/product/rangka-ayam.jpg'),
    (public._dc_uuid(p_organization_id, '10d'), 'Cop Ayam',                        '/product/cop-ayam.jpg')
  ) as x(id, name, image_url);

  insert into public.product_variants (id, organization_id, product_id, name, price_per_unit, created_by)
  select x.id, p_organization_id, x.product_id, x.name, x.price, v_actor
  from (values
    (public._dc_uuid(p_organization_id, '201'), public._dc_uuid(p_organization_id, '101'), 'Per kg',    11.50),
    (public._dc_uuid(p_organization_id, '202'), public._dc_uuid(p_organization_id, '101'), 'Per ekor',  16.00),
    (public._dc_uuid(p_organization_id, '203'), public._dc_uuid(p_organization_id, '102'), 'Per ekor',  28.00),
    (public._dc_uuid(p_organization_id, '204'), public._dc_uuid(p_organization_id, '103'), 'Per ekor',  14.00),
    (public._dc_uuid(p_organization_id, '205'), public._dc_uuid(p_organization_id, '104'), 'Per kg',    15.00),
    (public._dc_uuid(p_organization_id, '206'), public._dc_uuid(p_organization_id, '105'), 'Per kg',    13.00),
    (public._dc_uuid(p_organization_id, '207'), public._dc_uuid(p_organization_id, '106'), 'Per kg',    13.50),
    (public._dc_uuid(p_organization_id, '208'), public._dc_uuid(p_organization_id, '107'), 'Per kg',    16.00),
    (public._dc_uuid(p_organization_id, '209'), public._dc_uuid(p_organization_id, '108'), 'Per kg',    15.00),
    (public._dc_uuid(p_organization_id, '20a'), public._dc_uuid(p_organization_id, '109'), 'Per kg',     6.00),
    (public._dc_uuid(p_organization_id, '20b'), public._dc_uuid(p_organization_id, '10a'), 'Per kg',     7.00),
    (public._dc_uuid(p_organization_id, '20c'), public._dc_uuid(p_organization_id, '10b'), 'Per kg',     9.00),
    (public._dc_uuid(p_organization_id, '20d'), public._dc_uuid(p_organization_id, '10c'), 'Per kg',     5.00),
    (public._dc_uuid(p_organization_id, '20e'), public._dc_uuid(p_organization_id, '10d'), 'Per kg',    12.00)
  ) as x(id, product_id, name, price);

  -- Customers ----------------------------------------------------------------
  -- postcode is derived from the embedded address here (state/area cannot
  -- be resolved from SQL alone -- see the header comment on this migration).
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
  -- Run A: today, TRK-A, being loaded. Run B: yesterday, TRK-B, completed.
  insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
  values
    (public._dc_uuid(p_organization_id, '701'), p_organization_id, public._dc_uuid(p_organization_id, '601'), v_today, 'planned'),
    (public._dc_uuid(p_organization_id, '702'), p_organization_id, public._dc_uuid(p_organization_id, '602'), v_today - 1, 'completed');

  -- Orders -------------------------------------------------------------------
  -- 4 pending, 2 confirmed w/ open task, 1 confirmed weighed, 4 ready on run
  -- A (2 loaded), 3 delivered on run B, 1 cancelled = 15.
  -- run_sequence is not set here: the orders_set_run_sequence_trg BEFORE
  -- INSERT trigger assigns it in insertion order, so the VALUES row order of
  -- run-assigned orders below is what determines stop sequence.
  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    assignment_source, total_amount, loaded_at, loaded_by, closed_at
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
    o.total_amount,
    case when o.loaded then now() - interval '2 hours' else null end,
    case when o.loaded then v_actor else null end,
    case when o.status = 'delivered' then now() - interval '20 hours' else null end
  from (values
    -- pending
    (public._dc_uuid(p_organization_id, '801'), public._dc_uuid(p_organization_id, '301'), 'pending',   public._dc_uuid(p_organization_id, '401'), '80000', 1, public._dc_uuid(p_organization_id, '601'), null::uuid, 0::numeric, false),
    (public._dc_uuid(p_organization_id, '802'), public._dc_uuid(p_organization_id, '302'), 'pending',   public._dc_uuid(p_organization_id, '401'), '81100', 1, public._dc_uuid(p_organization_id, '601'), null, 0, false),
    (public._dc_uuid(p_organization_id, '803'), public._dc_uuid(p_organization_id, '306'), 'pending',   public._dc_uuid(p_organization_id, '402'), '83000', 2, public._dc_uuid(p_organization_id, '602'), null, 0, false),
    (public._dc_uuid(p_organization_id, '804'), public._dc_uuid(p_organization_id, '309'), 'pending',   public._dc_uuid(p_organization_id, '403'), '85000', 3, public._dc_uuid(p_organization_id, '603'), null, 0, false),
    -- confirmed, task open
    (public._dc_uuid(p_organization_id, '805'), public._dc_uuid(p_organization_id, '303'), 'confirmed', public._dc_uuid(p_organization_id, '401'), '81300', 1, public._dc_uuid(p_organization_id, '601'), null, 0, false),
    (public._dc_uuid(p_organization_id, '806'), public._dc_uuid(p_organization_id, '307'), 'confirmed', public._dc_uuid(p_organization_id, '402'), '84000', 2, public._dc_uuid(p_organization_id, '602'), null, 0, false),
    -- confirmed, warehouse weighed (task done)
    (public._dc_uuid(p_organization_id, '807'), public._dc_uuid(p_organization_id, '304'), 'confirmed', public._dc_uuid(p_organization_id, '401'), '79100', 1, public._dc_uuid(p_organization_id, '601'), null, 0, false),
    -- ready on run A (today, TRK-A); first two already loaded
    (public._dc_uuid(p_organization_id, '808'), public._dc_uuid(p_organization_id, '301'), 'ready',     public._dc_uuid(p_organization_id, '401'), '80000', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), 0, true),
    (public._dc_uuid(p_organization_id, '809'), public._dc_uuid(p_organization_id, '302'), 'ready',     public._dc_uuid(p_organization_id, '401'), '81100', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), 0, true),
    (public._dc_uuid(p_organization_id, '80a'), public._dc_uuid(p_organization_id, '303'), 'ready',     public._dc_uuid(p_organization_id, '401'), '81300', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), 0, false),
    (public._dc_uuid(p_organization_id, '80b'), public._dc_uuid(p_organization_id, '305'), 'ready',     public._dc_uuid(p_organization_id, '401'), '80350', 0, public._dc_uuid(p_organization_id, '601'), public._dc_uuid(p_organization_id, '701'), 0, false),
    -- delivered yesterday on run B (TRK-B)
    (public._dc_uuid(p_organization_id, '80c'), public._dc_uuid(p_organization_id, '306'), 'delivered', public._dc_uuid(p_organization_id, '402'), '83000', -1, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '702'), 187.20, false),
    (public._dc_uuid(p_organization_id, '80d'), public._dc_uuid(p_organization_id, '307'), 'delivered', public._dc_uuid(p_organization_id, '402'), '84000', -1, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '702'), 97.50, false),
    (public._dc_uuid(p_organization_id, '80e'), public._dc_uuid(p_organization_id, '308'), 'delivered', public._dc_uuid(p_organization_id, '402'), '83700', -1, public._dc_uuid(p_organization_id, '602'), public._dc_uuid(p_organization_id, '702'), 138.00, false),
    -- cancelled
    (public._dc_uuid(p_organization_id, '80f'), public._dc_uuid(p_organization_id, '30a'), 'cancelled', public._dc_uuid(p_organization_id, '403'), '86000', 2, public._dc_uuid(p_organization_id, '603'), null, 0, false)
  ) as o(id, customer_id, status, zone_id, postcode, date_offset, truck_id, run_id, total_amount, loaded);

  -- Order items --------------------------------------------------------------
  -- Weighed/delivered lines carry warehouse and/or final weights + price.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, final_weight_kg, price_per_kg
  )
  select x.id, x.order_id, x.product_id, x.mode::public.order_item_mode, x.qty,
         x.smin, x.smax, 'mix'::public.order_fallback, x.wkg, x.fkg, x.price
  from (values
    -- pending orders: raw requests only
    (public._dc_uuid(p_organization_id, '901'), public._dc_uuid(p_organization_id, '801'), public._dc_uuid(p_organization_id, '101'), 'piece', 10::numeric, 1.3::numeric, 1.6::numeric, null::numeric, null::numeric, null::numeric),
    (public._dc_uuid(p_organization_id, '902'), public._dc_uuid(p_organization_id, '801'), public._dc_uuid(p_organization_id, '104'), 'kg',     5, 0.3, 0.5, null, null, null),
    (public._dc_uuid(p_organization_id, '903'), public._dc_uuid(p_organization_id, '802'), public._dc_uuid(p_organization_id, '102'), 'piece',  4, 1.1, 1.4, null, null, null),
    (public._dc_uuid(p_organization_id, '904'), public._dc_uuid(p_organization_id, '803'), public._dc_uuid(p_organization_id, '105'), 'kg',     8, 0.2, 0.4, null, null, null),
    (public._dc_uuid(p_organization_id, '905'), public._dc_uuid(p_organization_id, '804'), public._dc_uuid(p_organization_id, '107'), 'kg',     6, 0.1, 0.3, null, null, null),
    -- confirmed, task open
    (public._dc_uuid(p_organization_id, '906'), public._dc_uuid(p_organization_id, '805'), public._dc_uuid(p_organization_id, '101'), 'piece', 20, 1.4, 1.8, null, null, null),
    (public._dc_uuid(p_organization_id, '907'), public._dc_uuid(p_organization_id, '806'), public._dc_uuid(p_organization_id, '10b'), 'kg',     3, 0.1, 0.2, null, null, null),
    -- confirmed, warehouse weighed
    (public._dc_uuid(p_organization_id, '908'), public._dc_uuid(p_organization_id, '807'), public._dc_uuid(p_organization_id, '101'), 'piece', 15, 1.3, 1.7, 23.4, null, null),
    -- ready on run A: warehouse weighed
    (public._dc_uuid(p_organization_id, '909'), public._dc_uuid(p_organization_id, '808'), public._dc_uuid(p_organization_id, '101'), 'piece', 12, 1.3, 1.6, 17.8, null, null),
    (public._dc_uuid(p_organization_id, '90a'), public._dc_uuid(p_organization_id, '808'), public._dc_uuid(p_organization_id, '109'), 'kg',     4, 0.1, 0.2,  4.1, null, null),
    (public._dc_uuid(p_organization_id, '90b'), public._dc_uuid(p_organization_id, '809'), public._dc_uuid(p_organization_id, '106'), 'kg',    10, 0.2, 0.4, 10.3, null, null),
    (public._dc_uuid(p_organization_id, '90c'), public._dc_uuid(p_organization_id, '80a'), public._dc_uuid(p_organization_id, '104'), 'kg',     6, 0.3, 0.5,  6.2, null, null),
    (public._dc_uuid(p_organization_id, '90d'), public._dc_uuid(p_organization_id, '80b'), public._dc_uuid(p_organization_id, '10c'), 'kg',    12, 0.5, 0.9, 12.6, null, null),
    -- delivered: final weight + price (line totals sum to the order totals)
    (public._dc_uuid(p_organization_id, '90e'), public._dc_uuid(p_organization_id, '80c'), public._dc_uuid(p_organization_id, '101'), 'piece', 10, 1.4, 1.8, 16.5, 16.0, 11.70),
    (public._dc_uuid(p_organization_id, '90f'), public._dc_uuid(p_organization_id, '80d'), public._dc_uuid(p_organization_id, '105'), 'kg',     7, 0.2, 0.4,  7.6,  7.5, 13.00),
    (public._dc_uuid(p_organization_id, '910'), public._dc_uuid(p_organization_id, '80e'), public._dc_uuid(p_organization_id, '107'), 'kg',     9, 0.1, 0.3,  8.8,  8.625, 16.00),
    -- cancelled
    (public._dc_uuid(p_organization_id, '911'), public._dc_uuid(p_organization_id, '80f'), public._dc_uuid(p_organization_id, '103'), 'piece',  5, 1.0, 1.4, null, null, null)
  ) as x(id, order_id, product_id, mode, qty, smin, smax, wkg, fkg, price);

  -- Tasks: open for 805/806, done for the weighed/ready/delivered orders.
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
    (public._dc_uuid(p_organization_id, '80e'), 'done')
  ) as x(order_id, status);

  -- Warehouse weight log entries for every weighed line.
  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by)
  select p_organization_id, i.id, 'warehouse', i.warehouse_weight_kg, v_actor
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.organization_id = p_organization_id and i.warehouse_weight_kg is not null;

  -- Run B history: arrive/leave marks + delivered attempts for each stop.
  insert into public.run_stop_events (organization_id, run_id, order_id, kind, at, recorded_by)
  select p_organization_id, public._dc_uuid(p_organization_id, '702'), x.order_id,
         x.kind::public.stop_event_kind, now() - interval '24 hours' + x.offset_min * interval '1 minute', v_actor
  from (values
    (public._dc_uuid(p_organization_id, '80c'), 'arrive',  0),
    (public._dc_uuid(p_organization_id, '80c'), 'leave',  12),
    (public._dc_uuid(p_organization_id, '80d'), 'arrive', 45),
    (public._dc_uuid(p_organization_id, '80d'), 'leave',  58),
    (public._dc_uuid(p_organization_id, '80e'), 'arrive', 95),
    (public._dc_uuid(p_organization_id, '80e'), 'leave', 110)
  ) as x(order_id, kind, offset_min);

  insert into public.delivery_attempts (organization_id, run_id, order_id, outcome, received_by, cash_collected, attempted_at, recorded_by)
  select p_organization_id, public._dc_uuid(p_organization_id, '702'), x.order_id, 'delivered',
         x.received_by, x.cash, now() - interval '24 hours' + x.offset_min * interval '1 minute', v_actor
  from (values
    (public._dc_uuid(p_organization_id, '80c'), 'Wan',      187.20::numeric, 10),
    (public._dc_uuid(p_organization_id, '80d'), 'Kak Ros',   97.50, 56),
    (public._dc_uuid(p_organization_id, '80e'), 'Abu',      138.00, 108)
  ) as x(order_id, received_by, cash, offset_min);

  -- Note: the brief's "buyer portal" step inserted into public.buyer_orders /
  -- public.buyer_order_items. Those tables were dropped by
  -- 20260810000001_order_pipeline_schema.sql -- portal orders now live in
  -- public.orders (source='portal') via buyers.customer_id, so that step is
  -- omitted here; the relinked buyer above already keeps that identity live.

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
