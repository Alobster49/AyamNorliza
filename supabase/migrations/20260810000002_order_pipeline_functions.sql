-- 20260810000002_order_pipeline_functions.sql
-- Order lifecycle RPCs: get_delivery_options, place_order, confirm_order,
-- complete_order_task, set_run_status, close_order, cancel_order,
-- reopen_order. All security definer, search_path locked to public/pg_temp,
-- revoked from public and granted to authenticated only. Errors are raised
-- as `errcode = 'P0001'` with a machine-readable `message` the TS layer
-- maps to friendly text (see mapRpcError in order-actions.ts).

begin;

-- ---------------------------------------------------------------------------
-- Internal helpers: exception-safe casts for jsonb-sourced text. Return null
-- on any parse failure instead of raising 22P02, so every RPC below can turn
-- a malformed payload into its own machine-readable P0001 code instead of
-- leaking a raw Postgres cast error. Not part of the public RPC surface --
-- revoked from public, never granted to authenticated; only ever called
-- from within the security definer functions below, which run as their
-- owner and so aren't blocked by the missing grant.
-- ---------------------------------------------------------------------------
create or replace function public._order_safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public._order_safe_uuid(text) from public;

create or replace function public._order_safe_numeric(p_text text)
returns numeric
language plpgsql
immutable
as $$
begin
  return p_text::numeric;
exception when others then
  return null;
end;
$$;

revoke all on function public._order_safe_numeric(text) from public;

create or replace function public._order_safe_integer(p_text text)
returns integer
language plpgsql
immutable
as $$
begin
  return p_text::integer;
exception when others then
  return null;
end;
$$;

revoke all on function public._order_safe_integer(text) from public;

create or replace function public._order_safe_boolean(p_text text)
returns boolean
language plpgsql
immutable
as $$
begin
  return p_text::boolean;
exception when others then
  return null;
end;
$$;

revoke all on function public._order_safe_boolean(text) from public;

-- ---------------------------------------------------------------------------
-- get_delivery_options: zone -> valid (date, slot, truck) options for the
-- next 14 days starting tomorrow, minus blocked dates, minus full slots.
-- ---------------------------------------------------------------------------
create or replace function public.get_delivery_options(p_org uuid, p_zone uuid)
returns table (
  option_date date,
  slot_id uuid,
  truck_id uuid,
  truck_name text,
  start_time time,
  end_time time,
  remaining integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select option_date, slot_id, truck_id, truck_name, start_time, end_time, remaining
  from (
    select
      d::date as option_date,
      s.id as slot_id,
      t.id as truck_id,
      t.name as truck_name,
      s.start_time,
      s.end_time,
      case when s.max_orders is null then null
        else s.max_orders - (
          select count(*)::integer from public.orders o
          where o.slot_id = s.id and o.delivery_date = d::date and o.status <> 'cancelled'
        )
      end as remaining
    from generate_series(current_date + 1, current_date + 14, interval '1 day') as d
    join public.truck_zones tz on tz.zone_id = p_zone
    join public.trucks t on t.id = tz.truck_id and t.is_active = true and t.organization_id = p_org
    join public.delivery_slots s on s.truck_id = t.id and s.is_active = true
      and s.weekday = extract(dow from d)::smallint
    where not exists (
      select 1 from public.schedule_blocks b
      where b.organization_id = p_org
        and b.block_date = d::date
        and (b.truck_id is null or b.truck_id = t.id)
    )
  ) options
  where remaining is null or remaining > 0
  order by option_date, start_time;
$$;

revoke all on function public.get_delivery_options(uuid, uuid) from public;
grant execute on function public.get_delivery_options(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- place_order: validates zone/slot/date/capacity/items, resolves the
-- customer (portal buyer or manager-picked), inserts the order + items.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_org uuid,
  p_zone uuid,
  p_slot uuid,
  p_date date,
  p_address text,
  p_notes text,
  p_items jsonb,
  p_customer uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_truck_id uuid;
  v_max_orders integer;
  v_slot_weekday smallint;
  v_count integer;
  v_customer_id uuid;
  v_source text;
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_mode text;
  v_fallback text;
  v_quantity numeric;
  v_size_min numeric;
  v_size_max numeric;
begin
  if not exists (select 1 from public.delivery_zones where id = p_zone and organization_id = p_org) then
    raise exception using errcode = 'P0001', message = 'zone_not_found';
  end if;

  -- Lock the slot row so a concurrent place_order for the same slot+date
  -- blocks until this transaction commits, making the capacity check below
  -- race-free.
  perform 1 from public.delivery_slots where id = p_slot for update;

  select s.truck_id, s.max_orders, s.weekday
    into v_truck_id, v_max_orders, v_slot_weekday
  from public.delivery_slots s
  join public.trucks t on t.id = s.truck_id and t.is_active = true
  join public.truck_zones tz on tz.truck_id = s.truck_id and tz.zone_id = p_zone
  where s.id = p_slot
    and s.is_active = true
    and s.organization_id = p_org;

  if v_truck_id is null then
    raise exception using errcode = 'P0001', message = 'slot_not_found';
  end if;

  if p_date < current_date + 1 or p_date > current_date + 14 then
    raise exception using errcode = 'P0001', message = 'date_out_of_window';
  end if;

  if v_slot_weekday <> extract(dow from p_date)::smallint then
    raise exception using errcode = 'P0001', message = 'weekday_mismatch';
  end if;

  if exists (
    select 1 from public.schedule_blocks
    where organization_id = p_org
      and block_date = p_date
      and (truck_id is null or truck_id = v_truck_id)
  ) then
    raise exception using errcode = 'P0001', message = 'date_blocked';
  end if;

  if v_max_orders is not null then
    select count(*) into v_count
    from public.orders
    where slot_id = p_slot and delivery_date = p_date and status <> 'cancelled';

    if v_count >= v_max_orders then
      raise exception using errcode = 'P0001', message = 'slot_full';
    end if;
  end if;

  if p_customer is null then
    if not exists (select 1 from public.buyers where id = auth.uid() and organization_id = p_org) then
      raise exception using errcode = 'P0001', message = 'forbidden';
    end if;

    select customer_id into v_customer_id from public.buyers where id = auth.uid();

    if v_customer_id is null then
      insert into public.customers (organization_id, name, phone, created_by)
      select p_org, b.display_name, coalesce(b.phone, '-----'), auth.uid()
      from public.buyers b
      where b.id = auth.uid()
      returning id into v_customer_id;

      update public.buyers set customer_id = v_customer_id where id = auth.uid();
    end if;

    v_source := 'portal';
  else
    if not public.has_org_role(p_org, array['owner', 'org_admin', 'seller']) then
      raise exception using errcode = 'P0001', message = 'forbidden';
    end if;

    if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
      raise exception using errcode = 'P0001', message = 'forbidden';
    end if;

    v_customer_id := p_customer;
    v_source := 'manual';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid_items';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := public._order_safe_uuid(v_item->>'productId');
    v_mode := v_item->>'mode';
    v_fallback := v_item->>'fallback';
    v_quantity := public._order_safe_numeric(v_item->>'quantity');
    v_size_min := public._order_safe_numeric(v_item->>'sizeMinKg');
    v_size_max := public._order_safe_numeric(v_item->>'sizeMaxKg');

    if v_product_id is null or v_mode not in ('piece', 'kg') or v_fallback not in ('cancel', 'mix', 'upsize', 'downsize') then
      raise exception using errcode = 'P0001', message = 'invalid_items';
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = 'P0001', message = 'invalid_items';
    end if;

    if v_mode = 'piece' and v_quantity <> trunc(v_quantity) then
      raise exception using errcode = 'P0001', message = 'invalid_items';
    end if;

    if v_size_min is null or v_size_min <= 0 or v_size_max is null or v_size_max < v_size_min then
      raise exception using errcode = 'P0001', message = 'invalid_items';
    end if;

    if not exists (
      select 1 from public.products
      where id = v_product_id
        and organization_id = p_org
        and is_active = true
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_items';
    end if;
  end loop;

  insert into public.orders (
    organization_id, customer_id, created_by, source, status,
    zone_id, delivery_address, delivery_date, slot_id, truck_id, notes
  ) values (
    p_org, v_customer_id, auth.uid(), v_source, 'pending',
    p_zone, p_address, p_date, p_slot, v_truck_id, p_notes
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, mode, quantity, size_min_kg, size_max_kg, fallback
    ) values (
      v_order_id,
      public._order_safe_uuid(v_item->>'productId'),
      (v_item->>'mode')::public.order_item_mode,
      public._order_safe_numeric(v_item->>'quantity'),
      public._order_safe_numeric(v_item->>'sizeMinKg'),
      public._order_safe_numeric(v_item->>'sizeMaxKg'),
      (v_item->>'fallback')::public.order_fallback
    );
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid) from public;
grant execute on function public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_order: manager stock check. Applies pre-declared fallback to
-- unavailable lines; cancels the order if every line ends up cancelled;
-- otherwise attaches the order to its truck+date delivery_runs row and
-- creates the allocate_weigh task.
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
  -- order with a well-formed item_id/available pair, and every line must be
  -- covered, before any row is touched.
  for v_decision in select * from jsonb_array_elements(p_decisions)
  loop
    v_item_id := public._order_safe_uuid(v_decision->>'item_id');
    v_available := public._order_safe_boolean(v_decision->>'available');

    if v_item_id is null or v_available is null or v_item_id = any(v_seen_ids) then
      raise exception using errcode = 'P0001', message = 'decisions_incomplete';
    end if;

    if not exists (select 1 from public.order_items where id = v_item_id and order_id = p_order) then
      raise exception using errcode = 'P0001', message = 'decisions_incomplete';
    end if;

    v_seen_ids := array_append(v_seen_ids, v_item_id);
  end loop;

  if coalesce(array_length(v_seen_ids, 1), 0) <> v_item_count then
    raise exception using errcode = 'P0001', message = 'decisions_incomplete';
  end if;

  -- Apply pass: mark unavailable lines with their pre-declared fallback.
  for v_decision in select * from jsonb_array_elements(p_decisions)
  loop
    if public._order_safe_boolean(v_decision->>'available') = false then
      update public.order_items
      set fallback_applied = fallback,
          is_cancelled = (fallback = 'cancel')
      where id = public._order_safe_uuid(v_decision->>'item_id') and order_id = p_order;
    end if;
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
-- complete_order_task: staff key warehouse weight/pieces per line, mark the
-- task done, move the order to ready.
-- ---------------------------------------------------------------------------
create or replace function public.complete_order_task(p_task uuid, p_weights jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_order_id uuid;
  v_task_status public.order_task_status;
  v_order_status public.order_status;
  v_item_count integer;
  v_weight jsonb;
  v_item_id uuid;
  v_weight_kg numeric;
  v_pieces integer;
  v_pieces_text text;
  v_seen_ids uuid[] := '{}';
begin
  select ot.organization_id, ot.order_id, ot.status, o.status
    into v_org, v_order_id, v_task_status, v_order_status
  from public.order_tasks ot
  join public.orders o on o.id = ot.order_id
  where ot.id = p_task
  for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'inventory', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_task_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'task_done';
  end if;

  if v_order_status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if p_weights is null or jsonb_typeof(p_weights) <> 'array' or jsonb_array_length(p_weights) = 0 then
    raise exception using errcode = 'P0001', message = 'weights_incomplete';
  end if;

  select count(*) into v_item_count
  from public.order_items where order_id = v_order_id and is_cancelled = false;

  -- Validation pass: every weight entry must name a real, distinct,
  -- not-yet-cancelled line on this order with a well-formed item_id and a
  -- positive weight_kg, and every line must be covered, before any row is
  -- touched.
  for v_weight in select * from jsonb_array_elements(p_weights)
  loop
    v_item_id := public._order_safe_uuid(v_weight->>'item_id');

    if v_item_id is null or v_item_id = any(v_seen_ids) then
      raise exception using errcode = 'P0001', message = 'weights_incomplete';
    end if;

    if not exists (
      select 1 from public.order_items
      where id = v_item_id and order_id = v_order_id and is_cancelled = false
    ) then
      raise exception using errcode = 'P0001', message = 'weights_incomplete';
    end if;

    v_seen_ids := array_append(v_seen_ids, v_item_id);

    v_weight_kg := public._order_safe_numeric(v_weight->>'weight_kg');

    if v_weight_kg is null or v_weight_kg <= 0 then
      raise exception using errcode = 'P0001', message = 'invalid_weight';
    end if;

    v_pieces_text := nullif(v_weight->>'pieces', '');

    if v_pieces_text is not null and public._order_safe_integer(v_pieces_text) is null then
      raise exception using errcode = 'P0001', message = 'weights_incomplete';
    end if;
  end loop;

  if coalesce(array_length(v_seen_ids, 1), 0) <> v_item_count then
    raise exception using errcode = 'P0001', message = 'weights_incomplete';
  end if;

  -- Apply pass.
  for v_weight in select * from jsonb_array_elements(p_weights)
  loop
    v_item_id := public._order_safe_uuid(v_weight->>'item_id');
    v_weight_kg := public._order_safe_numeric(v_weight->>'weight_kg');
    v_pieces_text := nullif(v_weight->>'pieces', '');
    v_pieces := case when v_pieces_text is null then null else public._order_safe_integer(v_pieces_text) end;

    update public.order_items
    set warehouse_weight_kg = v_weight_kg, warehouse_pieces = v_pieces
    where id = v_item_id and order_id = v_order_id;

    insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
    values (v_org, v_item_id, 'warehouse', v_weight_kg, v_pieces, auth.uid());
  end loop;

  update public.order_tasks
  set status = 'done', done_by = auth.uid(), done_at = now()
  where id = p_task;

  update public.orders set status = 'ready' where id = v_order_id;
end;
$$;

revoke all on function public.complete_order_task(uuid, jsonb) from public;
grant execute on function public.complete_order_task(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- set_run_status: manager marks a run departed/completed. Completing a run
-- delivers every 'ready' order riding on it.
-- ---------------------------------------------------------------------------
create or replace function public.set_run_status(p_run uuid, p_status public.delivery_run_status)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_current public.delivery_run_status;
begin
  select organization_id, status into v_org, v_current from public.delivery_runs where id = p_run;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not (
    (v_current = 'planned' and p_status = 'departed')
    or (v_current = 'departed' and p_status = 'completed')
    or (v_current = 'planned' and p_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  update public.delivery_runs set status = p_status where id = p_run;

  if p_status = 'completed' then
    update public.orders set status = 'delivered' where run_id = p_run and status = 'ready';
  end if;
end;
$$;

revoke all on function public.set_run_status(uuid, public.delivery_run_status) from public;
grant execute on function public.set_run_status(uuid, public.delivery_run_status) to authenticated;

-- ---------------------------------------------------------------------------
-- close_order: manager keys final weight/pieces/price per line; total =
-- sum of the generated line_total for non-cancelled lines.
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
  -- line on this order with well-formed item_id/final_weight_kg/
  -- price_per_kg, and every line must be covered, before any row is
  -- touched.
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

    v_price := public._order_safe_numeric(v_line->>'price_per_kg');

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
    v_price := public._order_safe_numeric(v_line->>'price_per_kg');
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
-- cancel_order: manager cancels any order not yet closed/cancelled; a
-- non-member may only cancel their own order while it is still pending.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_order uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_created_by uuid;
  v_is_manager boolean;
begin
  select organization_id, status, created_by into v_org, v_status, v_created_by from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  v_is_manager := public.has_org_role(v_org, array['owner', 'org_admin', 'seller']);

  if v_is_manager then
    if v_status in ('closed', 'cancelled') then
      raise exception using errcode = 'P0001', message = 'invalid_status';
    end if;
  else
    if v_created_by is distinct from auth.uid() then
      raise exception using errcode = 'P0001', message = 'forbidden';
    end if;

    if v_status <> 'pending' then
      raise exception using errcode = 'P0001', message = 'invalid_status';
    end if;
  end if;

  update public.orders
  set status = 'cancelled',
      notes = coalesce(notes, '') || E'\nCancelled: ' || coalesce(p_reason, '-')
  where id = p_order;
end;
$$;

revoke all on function public.cancel_order(uuid, text) from public;
grant execute on function public.cancel_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_order: owner/org_admin only. Audit-logged.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_order(p_order uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
begin
  select organization_id, status into v_org, v_status from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status <> 'closed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  update public.orders set status = 'delivered', closed_at = null where id = p_order;

  insert into public.audit_log (
    id, organization_id, actor_user_id, event_type, entity_type, entity_id, before, after, reason, source
  ) values (
    gen_random_uuid(), v_org, auth.uid(), 'order.reopened', 'order', p_order,
    jsonb_build_object('status', 'closed'), jsonb_build_object('status', 'delivered'), p_reason, 'web'
  );
end;
$$;

revoke all on function public.reopen_order(uuid, text) from public;
grant execute on function public.reopen_order(uuid, text) to authenticated;

commit;
