-- Driver run flow: the driver starts their own run and keys final weights at
-- the door. The weights the driver records are the billed truth -- line_total
-- is generated from final_weight_kg * price_per_kg, and this migration makes
-- driver_deliver_stop write those weights and the recomputed order total in
-- the same transaction as the delivery record.

begin;

-- ---------------------------------------------------------------------------
-- driver_start_run: the driver (or the office on their behalf) departs the
-- run they are assigned to. Same side effect as dispatch_depart_truck:
-- non-ready orders are released back to the pool before the truck leaves.
-- ---------------------------------------------------------------------------
create or replace function public.driver_start_run(p_run uuid)
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
  select organization_id, status into v_org, v_current
  from public.delivery_runs where id = p_run for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(p_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_current <> 'planned' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  update public.orders
  set run_id = null, assignment_source = 'none'
  where run_id = p_run and status <> 'ready';

  update public.delivery_runs set status = 'departed' where id = p_run;
end;
$$;

revoke all on function public.driver_start_run(uuid) from public;
grant execute on function public.driver_start_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- driver_deliver_stop: goods handed over, weighed at the door.
--
-- Replaces the 5-arg version. p_lines must cover every non-cancelled item
-- exactly once with final_weight_kg > 0 (validation mirrors close_order).
-- Price is NEVER taken from p_lines: the confirm-time price_per_kg stands.
-- Returns the recomputed order total so the client can show it immediately.
-- ---------------------------------------------------------------------------
drop function if exists public.driver_deliver_stop(uuid, text, text, text, numeric);

create or replace function public.driver_deliver_stop(
  p_order uuid,
  p_received_by text default null,
  p_signature_path text default null,
  p_photo_path text default null,
  p_cash_collected numeric default null,
  p_lines jsonb default null
)
returns numeric
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_run uuid;
  v_status public.order_status;
  v_item_count integer;
  v_line jsonb;
  v_item_id uuid;
  v_weight numeric;
  v_pieces integer;
  v_pieces_text text;
  v_seen_ids uuid[] := '{}';
  v_total numeric;
begin
  select o.organization_id, o.run_id, o.status into v_org, v_run, v_status
  from public.orders o where o.id = p_order for update;

  if v_org is null or v_run is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(v_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  -- Delivering the same stop twice is a no-op, not an error: the driver's
  -- phone may retry a queued write after the office already recorded it.
  if v_status in ('delivered', 'closed') then
    return (select total_amount from public.orders where id = p_order);
  end if;

  if v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if p_cash_collected is not null and p_cash_collected < 0 then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'lines_incomplete';
  end if;

  select count(*) into v_item_count
  from public.order_items where order_id = p_order and is_cancelled = false;

  -- Validation pass: every line must name a real, distinct, not-cancelled
  -- item on this order with final_weight_kg > 0, and every item must be
  -- covered, before any row is touched. Mirrors close_order.
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

    v_pieces_text := nullif(v_line->>'final_pieces', '');
    if v_pieces_text is not null and public._order_safe_integer(v_pieces_text) is null then
      raise exception using errcode = 'P0001', message = 'lines_incomplete';
    end if;
  end loop;

  if coalesce(array_length(v_seen_ids, 1), 0) <> v_item_count then
    raise exception using errcode = 'P0001', message = 'lines_incomplete';
  end if;

  -- Apply pass. price_per_kg is intentionally untouched.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := public._order_safe_uuid(v_line->>'item_id');
    v_weight := public._order_safe_numeric(v_line->>'final_weight_kg');
    v_pieces_text := nullif(v_line->>'final_pieces', '');
    v_pieces := case when v_pieces_text is null then null else public._order_safe_integer(v_pieces_text) end;

    update public.order_items
    set final_weight_kg = v_weight, final_pieces = v_pieces
    where id = v_item_id and order_id = p_order;

    insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
    values (v_org, v_item_id, 'final', v_weight, v_pieces, auth.uid());
  end loop;

  select coalesce(sum(line_total), 0) into v_total
  from public.order_items
  where order_id = p_order and is_cancelled = false;

  insert into public.run_stop_events (organization_id, run_id, order_id, kind, recorded_by)
  values (v_org, v_run, p_order, 'leave', auth.uid());

  insert into public.delivery_attempts (
    organization_id, run_id, order_id, outcome,
    received_by, signature_path, photo_path, cash_collected, recorded_by
  )
  values (
    v_org, v_run, p_order, 'delivered',
    nullif(btrim(coalesce(p_received_by, '')), ''), p_signature_path, p_photo_path,
    p_cash_collected, auth.uid()
  );

  update public.orders set total_amount = v_total, status = 'delivered' where id = p_order;

  return v_total;
end;
$$;

revoke all on function public.driver_deliver_stop(uuid, text, text, text, numeric, jsonb) from public;
grant execute on function public.driver_deliver_stop(uuid, text, text, text, numeric, jsonb) to authenticated;

commit;
