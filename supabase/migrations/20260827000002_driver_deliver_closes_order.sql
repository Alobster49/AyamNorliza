-- 20260827000002_driver_deliver_closes_order.sql
-- A delivery the driver settled at the door closes the order.
--
-- driver_deliver_stop already does everything close_order does: it validates a
-- final weight for every live line, writes the weight log rows, and recomputes
-- total_amount from the generated line_total. The only thing it did not do was
-- move the order past 'delivered', so every finished stop piled up in the
-- office settlement queue showing "Not weighed yet" and a price the office had
-- to re-key from weights that were already correct.
--
-- Now the same condition close_order relies on -- every live line has a final
-- weight and a price -- closes the order right there, stamping closed_at. The
-- fallback path still exists for orders confirmed before price-at-confirm
-- (20260826000001), whose lines can have price_per_kg null: those stop at
-- 'delivered' and the office settles them as before.
--
-- Note this makes close_order unreachable for driver-settled orders (it
-- requires status 'delivered'), which is the same shape as before for
-- office-closed ones: closing is one-way either way.

begin;

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
  v_settled boolean;
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

  -- The door weights ARE the settlement. Every live line now carries a final
  -- weight (validated above) and, since price-at-confirm, a price -- which is
  -- exactly what close_order checks before it closes an order. So there is
  -- nothing left for the office to key: close it here and let the invoice be
  -- final. An order confirmed before price-at-confirm can still have a line
  -- with no price; that one stops at 'delivered' and the office settles it
  -- from the settlement queue, the same as before.
  select not exists (
    select 1 from public.order_items
    where order_id = p_order
      and is_cancelled = false
      and (final_weight_kg is null or price_per_kg is null)
  ) into v_settled;

  if v_settled then
    update public.orders
    set total_amount = v_total, status = 'closed', closed_at = now()
    where id = p_order;
  else
    update public.orders set total_amount = v_total, status = 'delivered' where id = p_order;
  end if;

  return v_total;
end;
$$;

revoke all on function public.driver_deliver_stop(uuid, text, text, text, numeric, jsonb) from public;
grant execute on function public.driver_deliver_stop(uuid, text, text, text, numeric, jsonb) to authenticated;

commit;
