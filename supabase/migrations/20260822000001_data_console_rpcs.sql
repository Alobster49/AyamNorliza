-- 20260822000001_data_console_rpcs.sql
-- Data console RPCs: admin_clear_org_data wipes an org's business data
-- (never users); admin_seed_demo_data clears then inserts a deterministic
-- realistic demo dataset. Both security definer, owner-only, granted to
-- authenticated. Errors: P0001 'forbidden'.

begin;

-- ---------------------------------------------------------------------------
-- admin_clear_org_data
-- ---------------------------------------------------------------------------
create or replace function public.admin_clear_org_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
begin
  if not public.has_org_role(p_organization_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  -- Children first, parents last. Users/members/profiles/buyers/audit stay.
  delete from public.order_weight_log where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('order_weight_log', v_n);

  delete from public.delivery_attempts where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('delivery_attempts', v_n);

  delete from public.run_stop_events where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('run_stop_events', v_n);

  delete from public.order_tasks where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('order_tasks', v_n);

  delete from public.order_items
   where order_id in (select id from public.orders where organization_id = p_organization_id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('order_items', v_n);

  delete from public.orders where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('orders', v_n);

  delete from public.delivery_runs where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('delivery_runs', v_n);

  delete from public.schedule_blocks where organization_id = p_organization_id;
  delete from public.delivery_slots where organization_id = p_organization_id;

  -- Buyers are users: keep the row, drop the link to the doomed customer.
  update public.buyers set customer_id = null
   where organization_id = p_organization_id and customer_id is not null;

  delete from public.customers where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('customers', v_n);

  delete from public.product_variants where organization_id = p_organization_id;
  delete from public.products where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('products', v_n);
  delete from public.categories where organization_id = p_organization_id;

  delete from public.truck_zones where organization_id = p_organization_id;
  delete from public.trucks where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('trucks', v_n);

  delete from public.zone_postcode_ranges where organization_id = p_organization_id;
  delete from public.delivery_zones where organization_id = p_organization_id;
  delete from public.bays where organization_id = p_organization_id;
  delete from public.facilities where organization_id = p_organization_id;

  return v_counts;
end;
$$;

revoke all on function public.admin_clear_org_data(uuid) from public;
grant execute on function public.admin_clear_org_data(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_seed_demo_data
-- ---------------------------------------------------------------------------
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
  values ('dd000000-0000-0000-0000-00000000c001', p_organization_id, 'Ayam Segar',
          'Fresh chicken, whole birds and cuts', v_actor);

  insert into public.products (id, organization_id, category_id, name, image_url, created_by)
  select x.id, p_organization_id, 'dd000000-0000-0000-0000-00000000c001', x.name, x.image_url, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000101'::uuid, 'Ayam Pedaging Seekor (Standard)', '/product/ayam-pedaging.jpg'),
    ('dd000000-0000-0000-0000-000000000102'::uuid, 'Ayam Kampung Seekor',             '/product/ayam-kampung.jpg'),
    ('dd000000-0000-0000-0000-000000000103'::uuid, 'Ayam Tua / Penelur Seekor',       '/product/ayam-tua.jpg'),
    ('dd000000-0000-0000-0000-000000000104'::uuid, 'Dada Ayam',                       '/product/dada-ayam.png'),
    ('dd000000-0000-0000-0000-000000000105'::uuid, 'Peha Ayam',                       '/product/peha-ayam.jpg'),
    ('dd000000-0000-0000-0000-000000000106'::uuid, 'Pangkal Peha',                    '/product/pangkal-peha.jpg'),
    ('dd000000-0000-0000-0000-000000000107'::uuid, 'Kepak Ayam',                      '/product/kepak-ayam.jpg'),
    ('dd000000-0000-0000-0000-000000000108'::uuid, 'Chicken Wing (3-Joint)',          '/product/chicken-wing.jpg'),
    ('dd000000-0000-0000-0000-000000000109'::uuid, 'Kaki Ayam',                       '/product/kaki-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010a'::uuid, 'Leher Ayam',                      '/product/leher-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010b'::uuid, 'Hati Ayam',                       '/product/hati-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010c'::uuid, 'Rangka Ayam',                     '/product/rangka-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010d'::uuid, 'Cop Ayam',                        '/product/cop-ayam.jpg')
  ) as x(id, name, image_url);

  insert into public.product_variants (id, organization_id, product_id, name, price_per_unit, created_by)
  select x.id, p_organization_id, x.product_id, x.name, x.price, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000201'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'Per kg',    11.50),
    ('dd000000-0000-0000-0000-000000000202'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'Per ekor',  16.00),
    ('dd000000-0000-0000-0000-000000000203'::uuid, 'dd000000-0000-0000-0000-000000000102'::uuid, 'Per ekor',  28.00),
    ('dd000000-0000-0000-0000-000000000204'::uuid, 'dd000000-0000-0000-0000-000000000103'::uuid, 'Per ekor',  14.00),
    ('dd000000-0000-0000-0000-000000000205'::uuid, 'dd000000-0000-0000-0000-000000000104'::uuid, 'Per kg',    15.00),
    ('dd000000-0000-0000-0000-000000000206'::uuid, 'dd000000-0000-0000-0000-000000000105'::uuid, 'Per kg',    13.00),
    ('dd000000-0000-0000-0000-000000000207'::uuid, 'dd000000-0000-0000-0000-000000000106'::uuid, 'Per kg',    13.50),
    ('dd000000-0000-0000-0000-000000000208'::uuid, 'dd000000-0000-0000-0000-000000000107'::uuid, 'Per kg',    16.00),
    ('dd000000-0000-0000-0000-000000000209'::uuid, 'dd000000-0000-0000-0000-000000000108'::uuid, 'Per kg',    15.00),
    ('dd000000-0000-0000-0000-00000000020a'::uuid, 'dd000000-0000-0000-0000-000000000109'::uuid, 'Per kg',     6.00),
    ('dd000000-0000-0000-0000-00000000020b'::uuid, 'dd000000-0000-0000-0000-00000000010a'::uuid, 'Per kg',     7.00),
    ('dd000000-0000-0000-0000-00000000020c'::uuid, 'dd000000-0000-0000-0000-00000000010b'::uuid, 'Per kg',     9.00),
    ('dd000000-0000-0000-0000-00000000020d'::uuid, 'dd000000-0000-0000-0000-00000000010c'::uuid, 'Per kg',     5.00),
    ('dd000000-0000-0000-0000-00000000020e'::uuid, 'dd000000-0000-0000-0000-00000000010d'::uuid, 'Per kg',    12.00)
  ) as x(id, product_id, name, price);

  -- Customers ----------------------------------------------------------------
  insert into public.customers (id, organization_id, name, phone, address, created_by)
  select x.id, p_organization_id, x.name, x.phone, x.address, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000301'::uuid, 'Restoran Nasi Ayam Hj Salleh', '012-7011234', '12 Jalan Dhoby, 80000 Johor Bahru'),
    ('dd000000-0000-0000-0000-000000000302'::uuid, 'Kedai Makan Mak Timah',        '013-7405566', '8 Jalan Molek 1/9, 81100 Johor Bahru'),
    ('dd000000-0000-0000-0000-000000000303'::uuid, 'Pasar Raya Aneka Skudai',      '07-5566788',  '2 Jalan Kebudayaan 4, 81300 Skudai'),
    ('dd000000-0000-0000-0000-000000000304'::uuid, 'Restoran Selera Kampung',      '011-10998877','5 Persiaran Puteri Selatan, 79100 Iskandar Puteri'),
    ('dd000000-0000-0000-0000-000000000305'::uuid, 'Ayamas Frozen Mart',           '012-7223344', '31 Jalan Sutera Tanjung 8/2, 80350 Johor Bahru'),
    ('dd000000-0000-0000-0000-000000000306'::uuid, 'Restoran Wan Sup Ayam',        '013-7778899', '14 Jalan Rahmat, 83000 Batu Pahat'),
    ('dd000000-0000-0000-0000-000000000307'::uuid, 'Kak Ros Catering',             '019-7551122', '3 Jalan Bakri, 84000 Muar'),
    ('dd000000-0000-0000-0000-000000000308'::uuid, 'Gerai Ayam Goreng Abu',        '017-7663355', '21 Jalan Besar, 83700 Yong Peng'),
    ('dd000000-0000-0000-0000-000000000309'::uuid, 'Restoran Bismillah Segamat',   '012-6889900', '9 Jalan Genuang, 85000 Segamat'),
    ('dd000000-0000-0000-0000-00000000030a'::uuid, 'Kluang Fresh Mart',            '018-7112233', '17 Jalan Duku, 86000 Kluang')
  ) as x(id, name, phone, address);

  -- Relink existing buyer accounts to fresh customer rows so buyer logins
  -- keep an order-ready CRM identity after the wipe.
  insert into public.customers (id, organization_id, name, phone, created_by)
  select b.id, p_organization_id, b.display_name, coalesce(b.phone, '-----'), v_actor
  from public.buyers b
  where b.organization_id = p_organization_id
  on conflict (id) do nothing;

  update public.buyers set customer_id = id
  where organization_id = p_organization_id;

  -- Logistics setup (matches the delivery setup console) ---------------------
  insert into public.facilities (id, organization_id, name, address_line, postcode, state, created_by)
  values ('dd000000-0000-0000-0000-000000000501', p_organization_id, 'Depoh Utama',
          'Lot 8, Jalan Perindustrian Senai 3', '81400', 'Johor', v_actor);

  insert into public.bays (id, organization_id, facility_id, name, position, created_by)
  values
    ('dd000000-0000-0000-0000-000000000511', p_organization_id, 'dd000000-0000-0000-0000-000000000501', 'Bay A', 0, v_actor),
    ('dd000000-0000-0000-0000-000000000512', p_organization_id, 'dd000000-0000-0000-0000-000000000501', 'Bay B', 1, v_actor);

  insert into public.delivery_zones (id, organization_id, name, display_order, created_by)
  values
    ('dd000000-0000-0000-0000-000000000401', p_organization_id, 'Zone 1', 0, v_actor),
    ('dd000000-0000-0000-0000-000000000402', p_organization_id, 'Zone 2', 1, v_actor),
    ('dd000000-0000-0000-0000-000000000403', p_organization_id, 'Zone 3', 2, v_actor);

  insert into public.zone_postcode_ranges (id, organization_id, zone_id, postcode_start, postcode_end, created_by)
  values
    ('dd000000-0000-0000-0000-000000000411', p_organization_id, 'dd000000-0000-0000-0000-000000000401', '79000', '82999', v_actor),
    ('dd000000-0000-0000-0000-000000000412', p_organization_id, 'dd000000-0000-0000-0000-000000000402', '83000', '84999', v_actor),
    ('dd000000-0000-0000-0000-000000000413', p_organization_id, 'dd000000-0000-0000-0000-000000000403', '85000', '86999', v_actor);

  insert into public.trucks (id, organization_id, name, code, bay_id, capacity_kg, created_by)
  values
    ('dd000000-0000-0000-0000-000000000601', p_organization_id, 'Truck South Zone',        'TRK-A', 'dd000000-0000-0000-0000-000000000511', 800, v_actor),
    ('dd000000-0000-0000-0000-000000000602', p_organization_id, 'Truck West Coast Zone',   'TRK-B', 'dd000000-0000-0000-0000-000000000512', 800, v_actor),
    ('dd000000-0000-0000-0000-000000000603', p_organization_id, 'Truck North & East Zone', 'TRK-C', null, 600, v_actor);

  insert into public.truck_zones (truck_id, zone_id, organization_id)
  values
    ('dd000000-0000-0000-0000-000000000601', 'dd000000-0000-0000-0000-000000000401', p_organization_id),
    ('dd000000-0000-0000-0000-000000000602', 'dd000000-0000-0000-0000-000000000402', p_organization_id),
    ('dd000000-0000-0000-0000-000000000603', 'dd000000-0000-0000-0000-000000000403', p_organization_id);

  -- One 09:00-13:00 slot per truck per weekday, so any delivery date works.
  insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, created_by)
  select p_organization_id, t.id, d.weekday::smallint, '09:00'::time, '13:00'::time, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000601'::uuid),
    ('dd000000-0000-0000-0000-000000000602'::uuid),
    ('dd000000-0000-0000-0000-000000000603'::uuid)
  ) as t(id)
  cross join generate_series(0, 6) as d(weekday);

  -- Runs ---------------------------------------------------------------------
  -- Run A: today, TRK-A, being loaded. Run B: yesterday, TRK-B, completed.
  insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
  values
    ('dd000000-0000-0000-0000-000000000701', p_organization_id, 'dd000000-0000-0000-0000-000000000601', v_today, 'planned'),
    ('dd000000-0000-0000-0000-000000000702', p_organization_id, 'dd000000-0000-0000-0000-000000000602', v_today - 1, 'completed');

  -- Orders -------------------------------------------------------------------
  -- 4 pending, 2 confirmed w/ open task, 1 confirmed weighed, 4 ready on run
  -- A (2 loaded), 3 delivered on run B, 1 cancelled = 15.
  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    run_sequence, assignment_source, total_amount, loaded_at, loaded_by, closed_at
  )
  select
    o.id, p_organization_id, o.customer_id, v_actor, 'manual', o.status::public.order_status,
    o.zone_id,
    (select address from public.customers c where c.id = o.customer_id),
    o.postcode, v_today + o.date_offset,
    (select s.id from public.delivery_slots s
      where s.organization_id = p_organization_id and s.truck_id = o.truck_id
        and s.weekday = extract(dow from v_today + o.date_offset)::smallint limit 1),
    o.truck_id, o.run_id, o.run_sequence,
    (case when o.run_id is null then 'none' else 'auto' end)::public.assignment_source,
    o.total_amount,
    case when o.loaded then now() - interval '2 hours' else null end,
    case when o.loaded then v_actor else null end,
    case when o.status = 'delivered' then now() - interval '20 hours' else null end
  from (values
    -- pending
    ('dd000000-0000-0000-0000-000000000801'::uuid, 'dd000000-0000-0000-0000-000000000301'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000401'::uuid, '80000', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null::uuid, null::int, 0::numeric, false),
    ('dd000000-0000-0000-0000-000000000802'::uuid, 'dd000000-0000-0000-0000-000000000302'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000401'::uuid, '81100', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null, null, 0, false),
    ('dd000000-0000-0000-0000-000000000803'::uuid, 'dd000000-0000-0000-0000-000000000306'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000402'::uuid, '83000', 2, 'dd000000-0000-0000-0000-000000000602'::uuid, null, null, 0, false),
    ('dd000000-0000-0000-0000-000000000804'::uuid, 'dd000000-0000-0000-0000-000000000309'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000403'::uuid, '85000', 3, 'dd000000-0000-0000-0000-000000000603'::uuid, null, null, 0, false),
    -- confirmed, task open
    ('dd000000-0000-0000-0000-000000000805'::uuid, 'dd000000-0000-0000-0000-000000000303'::uuid, 'confirmed', 'dd000000-0000-0000-0000-000000000401'::uuid, '81300', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null, null, 0, false),
    ('dd000000-0000-0000-0000-000000000806'::uuid, 'dd000000-0000-0000-0000-000000000307'::uuid, 'confirmed', 'dd000000-0000-0000-0000-000000000402'::uuid, '84000', 2, 'dd000000-0000-0000-0000-000000000602'::uuid, null, null, 0, false),
    -- confirmed, warehouse weighed (task done)
    ('dd000000-0000-0000-0000-000000000807'::uuid, 'dd000000-0000-0000-0000-000000000304'::uuid, 'confirmed', 'dd000000-0000-0000-0000-000000000401'::uuid, '79100', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null, null, 0, false),
    -- ready on run A (today, TRK-A); first two already loaded
    ('dd000000-0000-0000-0000-000000000808'::uuid, 'dd000000-0000-0000-0000-000000000301'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '80000', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 1, 0, true),
    ('dd000000-0000-0000-0000-000000000809'::uuid, 'dd000000-0000-0000-0000-000000000302'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '81100', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 2, 0, true),
    ('dd000000-0000-0000-0000-00000000080a'::uuid, 'dd000000-0000-0000-0000-000000000303'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '81300', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 3, 0, false),
    ('dd000000-0000-0000-0000-00000000080b'::uuid, 'dd000000-0000-0000-0000-000000000305'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '80350', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 4, 0, false),
    -- delivered yesterday on run B (TRK-B)
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'dd000000-0000-0000-0000-000000000306'::uuid, 'delivered', 'dd000000-0000-0000-0000-000000000402'::uuid, '83000', -1, 'dd000000-0000-0000-0000-000000000602'::uuid, 'dd000000-0000-0000-0000-000000000702'::uuid, 1, 187.20, false),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'dd000000-0000-0000-0000-000000000307'::uuid, 'delivered', 'dd000000-0000-0000-0000-000000000402'::uuid, '84000', -1, 'dd000000-0000-0000-0000-000000000602'::uuid, 'dd000000-0000-0000-0000-000000000702'::uuid, 2, 97.50, false),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'dd000000-0000-0000-0000-000000000308'::uuid, 'delivered', 'dd000000-0000-0000-0000-000000000402'::uuid, '83700', -1, 'dd000000-0000-0000-0000-000000000602'::uuid, 'dd000000-0000-0000-0000-000000000702'::uuid, 3, 138.00, false),
    -- cancelled
    ('dd000000-0000-0000-0000-00000000080f'::uuid, 'dd000000-0000-0000-0000-00000000030a'::uuid, 'cancelled', 'dd000000-0000-0000-0000-000000000403'::uuid, '86000', 2, 'dd000000-0000-0000-0000-000000000603'::uuid, null, null, 0, false)
  ) as o(id, customer_id, status, zone_id, postcode, date_offset, truck_id, run_id, run_sequence, total_amount, loaded);

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
    ('dd000000-0000-0000-0000-000000000901'::uuid, 'dd000000-0000-0000-0000-000000000801'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 10::numeric, 1.3::numeric, 1.6::numeric, null::numeric, null::numeric, null::numeric),
    ('dd000000-0000-0000-0000-000000000902'::uuid, 'dd000000-0000-0000-0000-000000000801'::uuid, 'dd000000-0000-0000-0000-000000000104'::uuid, 'kg',     5, 0.3, 0.5, null, null, null),
    ('dd000000-0000-0000-0000-000000000903'::uuid, 'dd000000-0000-0000-0000-000000000802'::uuid, 'dd000000-0000-0000-0000-000000000102'::uuid, 'piece',  4, 1.1, 1.4, null, null, null),
    ('dd000000-0000-0000-0000-000000000904'::uuid, 'dd000000-0000-0000-0000-000000000803'::uuid, 'dd000000-0000-0000-0000-000000000105'::uuid, 'kg',     8, 0.2, 0.4, null, null, null),
    ('dd000000-0000-0000-0000-000000000905'::uuid, 'dd000000-0000-0000-0000-000000000804'::uuid, 'dd000000-0000-0000-0000-000000000107'::uuid, 'kg',     6, 0.1, 0.3, null, null, null),
    -- confirmed, task open
    ('dd000000-0000-0000-0000-000000000906'::uuid, 'dd000000-0000-0000-0000-000000000805'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 20, 1.4, 1.8, null, null, null),
    ('dd000000-0000-0000-0000-000000000907'::uuid, 'dd000000-0000-0000-0000-000000000806'::uuid, 'dd000000-0000-0000-0000-00000000010b'::uuid, 'kg',     3, 0.1, 0.2, null, null, null),
    -- confirmed, warehouse weighed
    ('dd000000-0000-0000-0000-000000000908'::uuid, 'dd000000-0000-0000-0000-000000000807'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 15, 1.3, 1.7, 23.4, null, null),
    -- ready on run A: warehouse weighed
    ('dd000000-0000-0000-0000-000000000909'::uuid, 'dd000000-0000-0000-0000-000000000808'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 12, 1.3, 1.6, 17.8, null, null),
    ('dd000000-0000-0000-0000-00000000090a'::uuid, 'dd000000-0000-0000-0000-000000000808'::uuid, 'dd000000-0000-0000-0000-000000000109'::uuid, 'kg',     4, 0.1, 0.2,  4.1, null, null),
    ('dd000000-0000-0000-0000-00000000090b'::uuid, 'dd000000-0000-0000-0000-000000000809'::uuid, 'dd000000-0000-0000-0000-000000000106'::uuid, 'kg',    10, 0.2, 0.4, 10.3, null, null),
    ('dd000000-0000-0000-0000-00000000090c'::uuid, 'dd000000-0000-0000-0000-00000000080a'::uuid, 'dd000000-0000-0000-0000-000000000104'::uuid, 'kg',     6, 0.3, 0.5,  6.2, null, null),
    ('dd000000-0000-0000-0000-00000000090d'::uuid, 'dd000000-0000-0000-0000-00000000080b'::uuid, 'dd000000-0000-0000-0000-00000000010c'::uuid, 'kg',    12, 0.5, 0.9, 12.6, null, null),
    -- delivered: final weight + price (line totals sum to the order totals)
    ('dd000000-0000-0000-0000-00000000090e'::uuid, 'dd000000-0000-0000-0000-00000000080c'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 10, 1.4, 1.8, 16.5, 16.0, 11.70),
    ('dd000000-0000-0000-0000-00000000090f'::uuid, 'dd000000-0000-0000-0000-00000000080d'::uuid, 'dd000000-0000-0000-0000-000000000105'::uuid, 'kg',     7, 0.2, 0.4,  7.6,  7.5, 13.00),
    ('dd000000-0000-0000-0000-000000000910'::uuid, 'dd000000-0000-0000-0000-00000000080e'::uuid, 'dd000000-0000-0000-0000-000000000107'::uuid, 'kg',     9, 0.1, 0.3,  8.8,  8.625, 16.00),
    -- cancelled
    ('dd000000-0000-0000-0000-000000000911'::uuid, 'dd000000-0000-0000-0000-00000000080f'::uuid, 'dd000000-0000-0000-0000-000000000103'::uuid, 'piece',  5, 1.0, 1.4, null, null, null)
  ) as x(id, order_id, product_id, mode, qty, smin, smax, wkg, fkg, price);

  -- Tasks: open for 805/806, done for the weighed/ready/delivered orders.
  insert into public.order_tasks (organization_id, order_id, type, status, done_by, done_at)
  select p_organization_id, x.order_id, 'allocate_weigh', x.status::public.order_task_status,
         case when x.status = 'done' then v_actor end,
         case when x.status = 'done' then now() - interval '5 hours' end
  from (values
    ('dd000000-0000-0000-0000-000000000805'::uuid, 'pending'),
    ('dd000000-0000-0000-0000-000000000806'::uuid, 'pending'),
    ('dd000000-0000-0000-0000-000000000807'::uuid, 'done'),
    ('dd000000-0000-0000-0000-000000000808'::uuid, 'done'),
    ('dd000000-0000-0000-0000-000000000809'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080a'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080b'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'done')
  ) as x(order_id, status);

  -- Warehouse weight log entries for every weighed line.
  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by)
  select p_organization_id, i.id, 'warehouse', i.warehouse_weight_kg, v_actor
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.organization_id = p_organization_id and i.warehouse_weight_kg is not null;

  -- Run B history: arrive/leave marks + delivered attempts for each stop.
  insert into public.run_stop_events (organization_id, run_id, order_id, kind, at, recorded_by)
  select p_organization_id, 'dd000000-0000-0000-0000-000000000702', x.order_id,
         x.kind::public.stop_event_kind, now() - interval '24 hours' + x.offset_min * interval '1 minute', v_actor
  from (values
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'arrive',  0),
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'leave',  12),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'arrive', 45),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'leave',  58),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'arrive', 95),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'leave', 110)
  ) as x(order_id, kind, offset_min);

  insert into public.delivery_attempts (organization_id, run_id, order_id, outcome, received_by, cash_collected, attempted_at, recorded_by)
  select p_organization_id, 'dd000000-0000-0000-0000-000000000702', x.order_id, 'delivered',
         x.received_by, x.cash, now() - interval '24 hours' + x.offset_min * interval '1 minute', v_actor
  from (values
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'Wan',      187.20::numeric, 10),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'Kak Ros',   97.50, 56),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'Abu',      138.00, 108)
  ) as x(order_id, received_by, cash, offset_min);

  -- Note: the brief's "buyer portal" step inserted into public.buyer_orders /
  -- public.buyer_order_items. Those tables were dropped by
  -- 20260810000001_order_pipeline_schema.sql -- portal orders now live in
  -- public.orders (source='portal') via buyers.customer_id, so that step is
  -- omitted here; the relinked buyer above already keeps that identity live.

  return jsonb_build_object('products', 13, 'customers', 10, 'orders', 15, 'runs', 2);
end;
$$;

revoke all on function public.admin_seed_demo_data(uuid) from public;
grant execute on function public.admin_seed_demo_data(uuid) to authenticated;

commit;
