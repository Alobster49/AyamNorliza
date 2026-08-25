-- Price moves from settlement to confirm. Every client has a negotiated deal
-- price, so the seller keys RM/kg per line while confirming stock; close_order
-- keeps the confirmed price unless explicitly overridden. The public list
-- price on product_variants goes away entirely.

-- ---------------------------------------------------------------------------
-- confirm_order: manager stock check + per-line price. A decision must carry
-- price_per_kg > 0 for every line that survives (i.e. unless available=false
-- and the line's pre-declared fallback is 'cancel'). Otherwise identical to
-- 20260810000002: applies fallbacks, cancels the order if every line ends up
-- cancelled, attaches the delivery run and creates the allocate_weigh task.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_order(p_order uuid, p_decisions jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_truck_id uuid;
  v_delivery_date date;
  v_item_count integer;
  v_decision jsonb;
  v_item_id uuid;
  v_available boolean;
  v_price numeric;
  v_fallback public.order_fallback;
  v_seen_ids uuid[] := '{}';
  v_all_cancelled boolean;
  v_run_id uuid;
begin
  select organization_id, status, truck_id, delivery_date
    into v_org, v_status, v_truck_id, v_delivery_date
  from public.orders where id = p_order
  for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception using errcode = 'P0001', message = 'decisions_incomplete';
  end if;

  select count(*) into v_item_count from public.order_items where order_id = p_order;

  -- Validation pass: every decision must name a real, distinct line on this
  -- order with a well-formed item_id/available pair, every line must be
  -- covered, and every surviving line must carry a usable price, before any
  -- row is touched.
  for v_decision in select * from jsonb_array_elements(p_decisions)
  loop
    v_item_id := public._order_safe_uuid(v_decision->>'item_id');
    v_available := public._order_safe_boolean(v_decision->>'available');

    if v_item_id is null or v_available is null or v_item_id = any(v_seen_ids) then
      raise exception using errcode = 'P0001', message = 'decisions_incomplete';
    end if;

    select fallback into v_fallback
    from public.order_items where id = v_item_id and order_id = p_order;

    if v_fallback is null then
      raise exception using errcode = 'P0001', message = 'decisions_incomplete';
    end if;

    if not (v_available = false and v_fallback = 'cancel') then
      v_price := public._order_safe_numeric(v_decision->>'price_per_kg');
      if v_price is null or v_price <= 0 or v_price > 10000 then
        raise exception using errcode = 'P0001', message = 'invalid_price';
      end if;
    end if;

    v_seen_ids := array_append(v_seen_ids, v_item_id);
  end loop;

  if coalesce(array_length(v_seen_ids, 1), 0) <> v_item_count then
    raise exception using errcode = 'P0001', message = 'decisions_incomplete';
  end if;

  -- Apply pass: store the confirmed price on surviving lines and mark
  -- unavailable lines with their pre-declared fallback.
  for v_decision in select * from jsonb_array_elements(p_decisions)
  loop
    v_item_id := public._order_safe_uuid(v_decision->>'item_id');
    v_available := public._order_safe_boolean(v_decision->>'available');
    v_price := public._order_safe_numeric(v_decision->>'price_per_kg');

    if v_available = false then
      update public.order_items
      set fallback_applied = fallback,
          is_cancelled = (fallback = 'cancel')
      where id = v_item_id and order_id = p_order;
    end if;

    update public.order_items
    set price_per_kg = v_price
    where id = v_item_id and order_id = p_order and is_cancelled = false;
  end loop;

  select bool_and(is_cancelled) into v_all_cancelled from public.order_items where order_id = p_order;

  if v_all_cancelled then
    update public.orders set status = 'cancelled' where id = p_order;
    return;
  end if;

  insert into public.delivery_runs (organization_id, truck_id, run_date)
  values (v_org, v_truck_id, v_delivery_date)
  on conflict (truck_id, run_date) do update set updated_at = now()
  returning id into v_run_id;

  update public.orders set run_id = v_run_id, status = 'confirmed' where id = p_order;

  insert into public.order_tasks (organization_id, order_id, type)
  values (v_org, p_order, 'allocate_weigh')
  on conflict (order_id, type) do nothing;
end;
$$;

revoke all on function public.confirm_order(uuid, jsonb) from public;
grant execute on function public.confirm_order(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- close_order: manager keys final weight/pieces per line. price_per_kg is now
-- optional — the confirm-time price stands unless a line overrides it.
-- ---------------------------------------------------------------------------
create or replace function public.close_order(p_order uuid, p_lines jsonb)
returns numeric
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_item_count integer;
  v_line jsonb;
  v_item_id uuid;
  v_weight numeric;
  v_price numeric;
  v_pieces integer;
  v_pieces_text text;
  v_seen_ids uuid[] := '{}';
  v_total numeric;
begin
  select organization_id, status into v_org, v_status from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status <> 'delivered' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'lines_incomplete';
  end if;

  select count(*) into v_item_count
  from public.order_items where order_id = p_order and is_cancelled = false;

  -- Validation pass: every line must name a real, distinct, not-cancelled
  -- line on this order with a well-formed item_id/final_weight_kg, resolve to
  -- a usable price (override or confirm-time), and every line must be
  -- covered, before any row is touched.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := public._order_safe_uuid(v_line->>'item_id');

    if v_item_id is null or v_item_id = any(v_seen_ids) then
      raise exception using errcode = 'P0001', message = 'lines_incomplete';
    end if;

    if not exists (
      select 1 from public.order_items
      where id = v_item_id and order_id = p_order and is_cancelled = false
    ) then
      raise exception using errcode = 'P0001', message = 'lines_incomplete';
    end if;

    v_seen_ids := array_append(v_seen_ids, v_item_id);

    v_weight := public._order_safe_numeric(v_line->>'final_weight_kg');

    if v_weight is null or v_weight <= 0 then
      raise exception using errcode = 'P0001', message = 'invalid_weight';
    end if;

    v_price := coalesce(
      public._order_safe_numeric(v_line->>'price_per_kg'),
      (select price_per_kg from public.order_items where id = v_item_id)
    );

    if v_price is null or v_price < 0 then
      raise exception using errcode = 'P0001', message = 'invalid_price';
    end if;

    v_pieces_text := nullif(v_line->>'final_pieces', '');

    if v_pieces_text is not null and public._order_safe_integer(v_pieces_text) is null then
      raise exception using errcode = 'P0001', message = 'lines_incomplete';
    end if;
  end loop;

  if coalesce(array_length(v_seen_ids, 1), 0) <> v_item_count then
    raise exception using errcode = 'P0001', message = 'lines_incomplete';
  end if;

  -- Apply pass.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := public._order_safe_uuid(v_line->>'item_id');
    v_weight := public._order_safe_numeric(v_line->>'final_weight_kg');
    v_price := coalesce(
      public._order_safe_numeric(v_line->>'price_per_kg'),
      (select price_per_kg from public.order_items where id = v_item_id)
    );
    v_pieces_text := nullif(v_line->>'final_pieces', '');
    v_pieces := case when v_pieces_text is null then null else public._order_safe_integer(v_pieces_text) end;

    update public.order_items
    set final_weight_kg = v_weight, final_pieces = v_pieces, price_per_kg = v_price
    where id = v_item_id and order_id = p_order;

    insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
    values (v_org, v_item_id, 'final', v_weight, v_pieces, auth.uid());
  end loop;

  select coalesce(sum(line_total), 0) into v_total
  from public.order_items
  where order_id = p_order and is_cancelled = false;

  update public.orders
  set total_amount = v_total, closed_at = now(), status = 'closed'
  where id = p_order;

  return v_total;
end;
$$;

revoke all on function public.close_order(uuid, jsonb) from public;
grant execute on function public.close_order(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- No public list price: every client has their own deal, keyed at confirm.
-- ---------------------------------------------------------------------------
alter table public.product_variants drop column if exists price_per_unit;

-- ---------------------------------------------------------------------------
-- get_market_suggestions: same signature, but product_variants no longer has
-- a list price, so current_price is always null. Suggestions stay useful as
-- confirm-time hint chips.
-- ---------------------------------------------------------------------------
create or replace function public.get_market_suggestions(p_organization_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  product_name text,
  current_price numeric,
  market_item_code integer,
  market_base numeric,
  suggested_price numeric,
  latest_price_date date,
  stale boolean
)
language sql
stable
set search_path = public
as $$
  with org_states as (
    select coalesce(
      (select ms.states from public.market_settings ms
       where ms.org_id = p_organization_id),
      array['Selangor']
    ) as states
  ),
  mapped as (
    select pv.id, pv.name as variant_name, pr.name as product_name,
           pv.market_item_code,
           pv.market_margin_type, pv.market_margin_value
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    where pv.organization_id = p_organization_id
      and pv.market_item_code is not null
      and exists (
        select 1 from public.organization_members om
        where om.organization_id = p_organization_id
          and om.user_id = auth.uid()
          and om.status = 'active'
      )
  ),
  latest as (
    -- newest available date per item within the org's states
    select m.id as vid, max(mp.price_date) as max_date
    from mapped m
    cross join org_states os
    join public.market_prices mp
      on mp.item_code = m.market_item_code
     and mp.state = any(os.states)
    group by m.id
  ),
  base as (
    -- median of median_price over the 7-day window ending at max_date
    select l.vid,
           percentile_cont(0.5) within group (order by mp.median_price)
             ::numeric(10,2) as market_base,
           l.max_date
    from latest l
    join mapped m on m.id = l.vid
    cross join org_states os
    join public.market_prices mp
      on mp.item_code = m.market_item_code
     and mp.state = any(os.states)
     and mp.price_date > l.max_date - 7
     and mp.price_date <= l.max_date
    group by l.vid, l.max_date
  )
  select m.id, m.variant_name, m.product_name, null::numeric as current_price,
         m.market_item_code,
         b.market_base,
         case
           when b.market_base is null then null
           when m.market_margin_type = 'pct'
             then round(b.market_base * (1 + coalesce(m.market_margin_value, 0) / 100), 2)
           else round(b.market_base + coalesce(m.market_margin_value, 0), 2)
         end as suggested_price,
         b.max_date,
         coalesce(b.max_date < current_date - 3, true) as stale
  from mapped m
  left join base b on b.vid = m.id
  order by m.product_name, m.variant_name;
$$;

grant execute on function public.get_market_suggestions(uuid) to authenticated;
revoke execute on function public.get_market_suggestions(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- admin_seed_demo_data: full re-definition of 20260823000009 with the
-- product_variants insert no longer keying price_per_unit (column dropped).
-- Everything else is verbatim.
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
