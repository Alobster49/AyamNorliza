-- 20260814000002_place_order_postcode.sql
-- place_order gained a p_postcode parameter so the delivery postcode is
-- persisted inside the same security-definer RPC as the rest of the order
-- row, instead of via a follow-up `supabase.from("orders").update(...)`
-- call from the app layer. public.orders is RLS-locked with SELECT-only
-- grants -- "all writes via RPC" is the schema's invariant -- so that
-- follow-up update was silently rejected by Postgres (permission denied)
-- and the postcode never persisted. See order-actions.ts / portal-actions.ts.
--
-- p_postcode is appended as the new last parameter (default null) so the
-- existing positional/named call sites that predate this migration keep
-- working unchanged.

begin;

-- Signature is changing (new trailing parameter), so the old overload must
-- be dropped explicitly before `create or replace` can install the new one.
drop function if exists public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid);

create or replace function public.place_order(
  p_org uuid,
  p_zone uuid,
  p_slot uuid,
  p_date date,
  p_address text,
  p_notes text,
  p_items jsonb,
  p_customer uuid default null,
  p_postcode text default null
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
  if p_postcode is not null and p_postcode !~ '^[0-9]{5}$' then
    raise exception using errcode = 'P0001', message = 'invalid_postcode';
  end if;

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
    zone_id, delivery_address, delivery_date, slot_id, truck_id, notes, postcode
  ) values (
    p_org, v_customer_id, auth.uid(), v_source, 'pending',
    p_zone, p_address, p_date, p_slot, v_truck_id, p_notes, p_postcode
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

revoke all on function public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid, text) from public;
grant execute on function public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid, text) to authenticated;

commit;
