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
