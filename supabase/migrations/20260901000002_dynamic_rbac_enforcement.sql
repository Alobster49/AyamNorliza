-- 20260901000002_dynamic_rbac_enforcement.sql
--
-- Dynamic RBAC enforcement: every RPC and RLS policy that gated on
-- `has_org_role(org, array[...])` (a hardcoded role-name check) is rewritten
-- to `has_permission(org, resource, action)` (a role_id -> role_permissions
-- lookup), so a per-org role/grant edit in organization_roles/role_permissions
-- (Task 2's schema) actually changes what a member can do.
--
-- Method: every function body below is copied verbatim from its LATEST
-- definition across supabase/migrations/ (grepped, newest file wins) with
-- ONLY the guard expression changed -- no body was re-derived from memory.
-- Sources, per function:
--   place_order              <- 20260814000002_place_order_postcode.sql
--   confirm_order            <- 20260826000001_confirm_price.sql
--   close_order              <- 20260826000001_confirm_price.sql
--   cancel_order             <- 20260810000002_order_pipeline_functions.sql
--   reopen_order             <- 20260810000002_order_pipeline_functions.sql
--   set_run_status           <- 20260828000002_depart_loading_gate.sql
--   dispatch_depart_truck    <- 20260828000002_depart_loading_gate.sql
--   dispatch_assign_order    <- 20260820000002_loading_reset_on_move.sql
--   dispatch_unassign_order  <- 20260820000002_loading_reset_on_move.sql
--   dispatch_reorder_run     <- 20260821000001_run_sequence.sql
--   dispatch_assign_driver   <- 20260821000002_driver_role.sql
--   dispatch_claim_loading   <- 20260829000002_loading_claims.sql
--   dispatch_set_loaded      <- 20260829000002_loading_claims.sql
--   claim_weigh_task         <- 20260829000003_weigh_claims.sql
--   complete_order_task      <- 20260829000003_weigh_claims.sql
--   can_record_stop          <- 20260821000003_driver_write_path.sql
--   admin_clear_org_data     <- 20260822000001_data_console_rpcs.sql
--   get_dashboard_today      <- 20260824000002_dashboard_today_rpc.sql
--   get_dashboard_sales      <- 20260824000001_dashboard_sales_rpc.sql
--   get_dashboard_insights   <- 20260827000006_dashboard_insights_weight_loss.sql
--   approve/reject_leave_request, approve/reject_leave_credit,
--     close_leave_year       <- 20260830000002_hr_leave_rpcs.sql
--   leave_available          <- 20260830000003_hr_leave_hardening.sql (has the
--                                self-or-approver auth check; 000002's version
--                                had no auth check at all)
--
-- Judgment call recorded here (brief leaves this to the implementer):
-- get_dashboard_today/_sales/_insights are called from exactly one place --
-- src/features/dashboard/server/analytics-actions.ts (callDashboardRpc) --
-- which backs only the owner/admin dashboard page. No seller-facing code
-- calls them (grepped src/), and DEFAULT_ROLE_GRANTS' seller_crud array in
-- 20260901000001_dynamic_rbac_schema.sql does not include 'dashboard'. So
-- these three get the plain guard: has_permission(org,'dashboard','view').
-- The brief's OR-with-orders-view fallback is not applied.
--
-- Deliberate behavior change, plan-approved: admin_clear_org_data moves from
-- owner-only (`has_org_role(org, array['owner'])`) to
-- has_permission(org,'data_console.manage','use'), which is seeded to
-- org_admin only (see seed_system_roles: data_console.manage is excluded
-- from the owner's capability loop). This aligns the wipe RPC with the data
-- console being admin-only (owner cannot open the data console UI at all
-- per the 20260831000001 role realignment), removing the previous
-- contradiction where the RPC was reachable by a role that cannot see the
-- page that calls it.
--
-- Legacy role cleanup: 'farm_manager' is dropped from member_scopes_admin_write
-- (the only guard naming it outside of role check-constraint arrays, which
-- 20260831000001_role_realignment.sql already tightened). 'logistics' does not
-- appear in any RLS policy guard -- only in RPC guards, all rewritten below.
-- effective_capabilities()'s hardcoded base_matrix (20260712000002) still
-- lists farm_manager/logistics/etc as literal data rows, not as a security
-- guard; that table (role_capability_overrides) is scheduled for removal in
-- Task 13 and is left untouched here per the brief's scope.
--
-- has_org_role shim caveat (reviewer-flagged, Importance): the deprecated
-- shim below matches on r.key = any(roles) directly against
-- organization_roles.key -- it intentionally does NOT reproduce the
-- alias-resolving has_org_role that 20260831000001_role_realignment.sql
-- introduced (org_admin passes every 'owner' gate, supervisor passes every
-- 'seller' gate, inventory passes every 'logistics' gate). Any straggler
-- caller still gated on has_org_role(org, array['owner']) or
-- array[...,'logistics']) therefore now fails closed for org_admin /
-- inventory members, where it used to pass via the alias. Five policies in
-- this codebase are still on has_org_role and are NOT rewritten by this
-- migration, so they inherit that regression:
--   support_sessions_admin_write            -- has_org_role(org, {owner,org_admin})
--   role_caps_select_owner                  -- has_org_role(org, {owner})
--   role_caps_insert_owner                  -- has_org_role(org, {owner})
--   role_caps_update_owner                  -- has_org_role(org, {owner})
--   role_caps_delete_owner                  -- has_org_role(org, {owner})
-- support_sessions_admin_write already names 'org_admin' explicitly (not an
-- alias target), so it is unaffected. The four role_caps_* policies name
-- only 'owner' and therefore DO fail closed for org_admin under the new
-- shim (an org_admin can no longer read/write role_capability_overrides,
-- where the old alias-aware has_org_role let org_admin through as an
-- 'owner' gate). This is accepted rather than fixed here because:
--   * support_sessions is a retired feature (support role/sessions removed
--     by 20260831000001_role_realignment.sql) -- the policy is dead code
--     guarding an empty table.
--   * role_capability_overrides is superseded by role_permissions (Task 2)
--     and is dropped entirely in the Task 13 cleanup migration -- any
--     org_admin lockout here is temporary and scoped to a table already on
--     its way out, not a live admin capability.

begin;

-- ---------------------------------------------------------------------------
-- place_order: has_org_role({owner,org_admin,seller}) -> has_permission(orders,add)
-- Verbatim from 20260814000002_place_order_postcode.sql except the guard.
-- ---------------------------------------------------------------------------
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
    if not public.has_permission(p_org, 'orders', 'add') then
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

-- ---------------------------------------------------------------------------
-- confirm_order: has_org_role({owner,org_admin,seller}) -> has_permission(orders,edit)
-- Verbatim from 20260826000001_confirm_price.sql except the guard.
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

  if not public.has_permission(v_org, 'orders', 'edit') then
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
-- close_order: has_org_role({owner,org_admin,seller}) -> has_permission(orders,edit)
-- Verbatim from 20260826000001_confirm_price.sql except the guard.
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

  if not public.has_permission(v_org, 'orders', 'edit') then
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
-- cancel_order: has_org_role({owner,org_admin,seller}) -> has_permission(orders,edit)
-- Verbatim from 20260810000002_order_pipeline_functions.sql except the guard.
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

  v_is_manager := public.has_permission(v_org, 'orders', 'edit');

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
-- reopen_order: has_org_role({owner,org_admin}) -> has_permission(orders.reopen,use)
-- Verbatim from 20260810000002_order_pipeline_functions.sql except the guard.
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

  if not public.has_permission(v_org, 'orders.reopen', 'use') then
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

-- ---------------------------------------------------------------------------
-- set_run_status: has_org_role({owner,org_admin,seller}) -> has_permission(dispatch,edit)
-- Verbatim from 20260828000002_depart_loading_gate.sql except the guard.
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

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not (
    (v_current = 'planned' and p_status = 'departed')
    or (v_current = 'departed' and p_status = 'completed')
    or (v_current = 'planned' and p_status = 'completed')
    -- Idempotent re-fire: confirm_order can still attach a newly-confirmed
    -- order to an already-completed run's delivery_runs row (it upserts on
    -- (truck_id, run_date) with no run-status check), and that order can
    -- later reach 'ready' via complete_order_task. Without this case those
    -- orders are permanently stuck at 'ready' -- completed -> completed
    -- is allowed specifically so the ready -> delivered sweep below can
    -- run again and pick them up.
    or (v_current = 'completed' and p_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if p_status = 'departed' then
    if exists (
      select 1 from public.orders
      where run_id = p_run and status = 'ready' and loaded_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'not_loaded';
    end if;

    update public.orders
    set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
    where run_id = p_run and status <> 'ready';
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
-- dispatch_depart_truck: has_org_role({owner,org_admin,seller,logistics}) ->
-- has_permission(dispatch,edit). Verbatim from
-- 20260828000002_depart_loading_gate.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_depart_truck(p_truck uuid, p_date date)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_run uuid;
  v_current public.delivery_run_status;
begin
  select id, organization_id, status into v_run, v_org, v_current
  from public.delivery_runs
  where truck_id = p_truck and run_date = p_date
  for update;

  if v_run is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_current <> 'planned' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if exists (
    select 1 from public.orders
    where run_id = v_run and status = 'ready' and loaded_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'not_loaded';
  end if;

  update public.orders
  set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
  where run_id = v_run and status <> 'ready';

  update public.delivery_runs set status = 'departed' where id = v_run;
end;
$$;

revoke all on function public.dispatch_depart_truck(uuid, date) from public;
grant execute on function public.dispatch_depart_truck(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_assign_order: has_org_role({owner,org_admin,seller,logistics}) ->
-- has_permission(dispatch,edit). Verbatim from
-- 20260820000002_loading_reset_on_move.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_assign_order(p_order uuid, p_truck uuid, p_source public.assignment_source)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_date date;
  v_old_run uuid;
  v_old_run_status public.delivery_run_status;
  v_old_truck uuid;
  v_source public.assignment_source;
  v_run uuid;
begin
  if p_source not in ('auto', 'manual') then
    raise exception using errcode = 'P0001', message = 'invalid_source';
  end if;

  select organization_id, status, delivery_date, run_id, truck_id, assignment_source
  into v_org, v_status, v_date, v_old_run, v_old_truck, v_source
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  -- Auto never overrides manual.
  if p_source = 'auto' and v_source = 'manual' then
    return;
  end if;

  if v_old_run is not null then
    select status into v_old_run_status from public.delivery_runs where id = v_old_run;
    if v_old_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  if not exists (
    select 1 from public.trucks
    where id = p_truck and organization_id = v_org and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_truck';
  end if;

  insert into public.delivery_runs (organization_id, truck_id, run_date)
  values (v_org, p_truck, v_date)
  on conflict (truck_id, run_date) do update set truck_id = excluded.truck_id
  returning id into v_run;

  if (select status from public.delivery_runs where id = v_run) = 'departed' then
    raise exception using errcode = 'P0001', message = 'run_departed';
  end if;

  -- Moving to a different truck invalidates the load confirmation; a
  -- same-truck re-assign (pool -> back on its own truck) keeps it.
  update public.orders
  set truck_id = p_truck,
      run_id = v_run,
      assignment_source = p_source,
      loaded_at = case when p_truck is distinct from v_old_truck then null else loaded_at end,
      loaded_by = case when p_truck is distinct from v_old_truck then null else loaded_by end
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) from public;
grant execute on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_unassign_order: has_org_role({owner,org_admin,seller,logistics}) ->
-- has_permission(dispatch,edit). Verbatim from
-- 20260820000002_loading_reset_on_move.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_unassign_order(p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
begin
  select organization_id, status, run_id into v_org, v_status, v_run
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  -- Clear run_id too, not just assignment_source: leaving the old run_id
  -- behind blocks reassignment (dispatch_assign_order upserts the same
  -- truck+date row) and lets set_run_status's completion sweep
  -- (status='ready' and run_id = p_run) phantom-deliver a ticket that left
  -- the run.
  update public.orders
  set assignment_source = 'none', run_id = null, loaded_at = null, loaded_by = null
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_unassign_order(uuid) from public;
grant execute on function public.dispatch_unassign_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_reorder_run: has_org_role({owner,org_admin,seller,logistics}) ->
-- has_permission(dispatch,edit). Verbatim from 20260821000001_run_sequence.sql
-- except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_reorder_run(p_run uuid, p_order_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.delivery_run_status;
  v_actual uuid[];
begin
  select organization_id, status into v_org, v_status
  from public.delivery_runs where id = p_run for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status = 'completed' then
    raise exception using errcode = 'P0001', message = 'run_completed';
  end if;

  -- The caller's list must be exactly the run's orders: a stale page that is
  -- missing an order would otherwise silently strand it at the end.
  select array_agg(id order by id) into v_actual
  from public.orders where run_id = p_run;

  if coalesce(v_actual, array[]::uuid[])
     is distinct from (select array_agg(x order by x) from unnest(p_order_ids) as x)
  then
    raise exception using errcode = 'P0001', message = 'invalid_order_set';
  end if;

  update public.orders o
  set run_sequence = position.ordinality
  from unnest(p_order_ids) with ordinality as position(order_id, ordinality)
  where o.id = position.order_id and o.run_id = p_run;
end;
$$;

revoke all on function public.dispatch_reorder_run(uuid, uuid[]) from public;
grant execute on function public.dispatch_reorder_run(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_assign_driver: has_org_role({owner,org_admin,seller,logistics}) ->
-- has_permission(dispatch,edit). Verbatim from 20260821000002_driver_role.sql
-- except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_assign_driver(p_run uuid, p_driver uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.delivery_run_status;
begin
  select organization_id, status into v_org, v_status
  from public.delivery_runs where id = p_run for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status = 'completed' then
    raise exception using errcode = 'P0001', message = 'run_completed';
  end if;

  if p_driver is not null and not exists (
    select 1 from public.organization_members
    where organization_id = v_org
      and user_id = p_driver
      and status = 'active'
      and (expires_at is null or expires_at > now())
      and role = 'driver'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_driver';
  end if;

  update public.delivery_runs set driver_id = p_driver where id = p_run;
end;
$$;

revoke all on function public.dispatch_assign_driver(uuid, uuid) from public;
grant execute on function public.dispatch_assign_driver(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_claim_loading: has_org_role({owner,org_admin,seller,logistics}) ->
-- has_permission(loading,edit) OR has_permission(dispatch,edit). Verbatim from
-- 20260829000002_loading_claims.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_claim_loading(p_order uuid, p_claim boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
  v_loaded_at timestamptz;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
begin
  select organization_id, status, run_id, loaded_at, loading_claimed_by, loading_claimed_at
  into v_org, v_status, v_run, v_loaded_at, v_claimed_by, v_claimed_at
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not (public.has_permission(v_org, 'loading', 'edit') or public.has_permission(v_org, 'dispatch', 'edit')) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not p_claim then
    -- Release is deliberately open to any dispatch role, not just the
    -- claimer: it is how a stuck claim gets cleared before the TTL runs out.
    update public.orders
    set loading_claimed_by = null, loading_claimed_at = null
    where id = p_order;
    return;
  end if;

  if v_run is null then
    raise exception using errcode = 'P0001', message = 'not_assigned';
  end if;

  select status into v_run_status from public.delivery_runs where id = v_run;
  if v_run_status = 'departed' then
    raise exception using errcode = 'P0001', message = 'run_departed';
  end if;

  if v_loaded_at is not null then
    raise exception using errcode = 'P0001', message = 'already_loaded';
  end if;

  if v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'not_weighed';
  end if;

  -- Free means: never claimed, claim expired, or already mine (re-claim
  -- refreshes the timestamp).
  if v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  update public.orders
  set loading_claimed_by = auth.uid(), loading_claimed_at = now()
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_claim_loading(uuid, boolean) from public;
grant execute on function public.dispatch_claim_loading(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_set_loaded: has_org_role({owner,org_admin,seller,logistics}) ->
-- has_permission(loading,edit) OR has_permission(dispatch,edit). Verbatim from
-- 20260829000002_loading_claims.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_set_loaded(p_order uuid, p_loaded boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
  v_loaded_at timestamptz;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
begin
  select organization_id, status, run_id, loaded_at, loading_claimed_by, loading_claimed_at
  into v_org, v_status, v_run, v_loaded_at, v_claimed_by, v_claimed_at
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not (public.has_permission(v_org, 'loading', 'edit') or public.has_permission(v_org, 'dispatch', 'edit')) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  if p_loaded and v_run is null then
    raise exception using errcode = 'P0001', message = 'not_assigned';
  end if;

  -- 'ready' is set only by complete_order_task, after every non-cancelled
  -- line has a recorded weight -- so this is the "fully weighed" gate.
  if p_loaded and v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'not_weighed';
  end if;

  -- A second worker loading the same order used to silently overwrite
  -- loaded_by; now the stale screen gets told and refetches.
  if p_loaded and v_loaded_at is not null then
    raise exception using errcode = 'P0001', message = 'already_loaded';
  end if;

  if p_loaded
     and v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  update public.orders
  set loaded_at = case when p_loaded then now() else null end,
      loaded_by = case when p_loaded then auth.uid() else null end,
      loading_claimed_by = null,
      loading_claimed_at = null
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_set_loaded(uuid, boolean) from public;
grant execute on function public.dispatch_set_loaded(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- claim_weigh_task: has_org_role({owner,org_admin,seller,inventory,logistics})
-- -> has_permission(warehouse_tasks,edit). Verbatim from
-- 20260829000003_weigh_claims.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.claim_weigh_task(p_task uuid, p_claim boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_task_status public.order_task_status;
  v_order_status public.order_status;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
begin
  select ot.organization_id, ot.status, o.status, ot.weigh_claimed_by, ot.weigh_claimed_at
  into v_org, v_task_status, v_order_status, v_claimed_by, v_claimed_at
  from public.order_tasks ot
  join public.orders o on o.id = ot.order_id
  where ot.id = p_task
  for update of ot;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_permission(v_org, 'warehouse_tasks', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not p_claim then
    -- Release is deliberately open to any staff role, not just the
    -- claimer: it is how a stuck claim gets cleared before the TTL runs out.
    update public.order_tasks
    set weigh_claimed_by = null, weigh_claimed_at = null
    where id = p_task;
    return;
  end if;

  if v_task_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'task_done';
  end if;

  if v_order_status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  -- Free means: never claimed, claim expired, or already mine (re-claim
  -- refreshes the timestamp).
  if v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  update public.order_tasks
  set weigh_claimed_by = auth.uid(), weigh_claimed_at = now()
  where id = p_task;
end;
$$;

revoke all on function public.claim_weigh_task(uuid, boolean) from public;
grant execute on function public.claim_weigh_task(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_order_task: has_org_role({owner,org_admin,seller,inventory,logistics})
-- -> has_permission(warehouse_tasks,edit). Verbatim from
-- 20260829000003_weigh_claims.sql except the guard.
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
  v_claimed_by uuid;
  v_claimed_at timestamptz;
  v_item_count integer;
  v_weight jsonb;
  v_item_id uuid;
  v_weight_kg numeric;
  v_pieces integer;
  v_pieces_text text;
  v_seen_ids uuid[] := '{}';
begin
  select ot.organization_id, ot.order_id, ot.status, o.status,
         ot.weigh_claimed_by, ot.weigh_claimed_at
    into v_org, v_order_id, v_task_status, v_order_status,
         v_claimed_by, v_claimed_at
  from public.order_tasks ot
  join public.orders o on o.id = ot.order_id
  where ot.id = p_task
  for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_permission(v_org, 'warehouse_tasks', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_task_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'task_done';
  end if;

  if v_order_status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
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
  set status = 'done', done_by = auth.uid(), done_at = now(),
      weigh_claimed_by = null,
      weigh_claimed_at = null
  where id = p_task;

  update public.orders set status = 'ready' where id = v_order_id;
end;
$$;

revoke all on function public.complete_order_task(uuid, jsonb) from public;
grant execute on function public.complete_order_task(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- can_record_stop: has_org_role({owner,org_admin,seller,logistics}) OR
-- assigned driver -> has_permission(driver_deck,edit) OR assigned driver
-- (that OR branch is kept verbatim). Verbatim from
-- 20260821000003_driver_write_path.sql except the has_org_role half.
-- ---------------------------------------------------------------------------
create or replace function public.can_record_stop(p_run uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.delivery_runs where id = p_run and driver_id = (select auth.uid()))
    or public.has_permission(p_org, 'driver_deck', 'edit');
$$;

revoke all on function public.can_record_stop(uuid, uuid) from public;
grant execute on function public.can_record_stop(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_clear_org_data: has_org_role({owner}) -> has_permission(data_console.manage,use).
-- Deliberate behavior change -- see header comment above. Verbatim from
-- 20260822000001_data_console_rpcs.sql except the guard.
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
  if not public.has_permission(p_organization_id, 'data_console.manage', 'use') then
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
-- get_dashboard_today: has_org_role({owner,org_admin,seller}) ->
-- has_permission(dashboard,view). Judgment call recorded in the header
-- comment above: only the dashboard page calls this, so the plain guard is
-- used (no OR orders/view fallback). Verbatim from
-- 20260824000002_dashboard_today_rpc.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_today(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_today date;
  v_runs jsonb;
  v_tasks_pending integer;
  v_tasks_done_today integer;
  v_orders_without_run integer;
  v_market_date date;
begin
  if not public.has_permission(p_organization_id, 'dashboard', 'view') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;

  v_today := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'truckName', t.name,
           'truckCode', t.code,
           'status', r.status,
           'ordersTotal', (select count(*) from public.orders o where o.run_id = r.id),
           'delivered', (select count(*) from public.orders o
                         where o.run_id = r.id and o.status in ('delivered','closed')),
           'failed', (select count(*) from public.orders o
                      where o.run_id = r.id and (
                        select da.outcome::text from public.delivery_attempts da
                        where da.order_id = o.id and da.run_id = r.id
                        order by da.attempted_at desc limit 1) = 'failed')
         ) order by t.code), '[]'::jsonb)
  into v_runs
  from public.delivery_runs r
  join public.trucks t on t.id = r.truck_id
  where r.organization_id = p_organization_id
    and r.run_date = v_today;

  select count(*) into v_tasks_pending
  from public.order_tasks ot
  where ot.organization_id = p_organization_id and ot.status = 'pending';

  select count(*) into v_tasks_done_today
  from public.order_tasks ot
  where ot.organization_id = p_organization_id
    and ot.status = 'done'
    and ot.done_at is not null
    and ((ot.done_at at time zone v_tz)::date) = v_today;

  select count(*) into v_orders_without_run
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('confirmed','ready')
    and o.run_id is null
    and o.delivery_date = v_today;

  select max(mp.price_date) into v_market_date
  from public.market_prices mp
  where mp.state = any (
    coalesce(
      (select ms.states from public.market_settings ms where ms.org_id = p_organization_id),
      array['Selangor']
    )
  );

  return jsonb_build_object(
    'date', v_today,
    'runs', v_runs,
    'tasksPending', v_tasks_pending,
    'tasksDoneToday', v_tasks_done_today,
    'ordersWithoutRun', v_orders_without_run,
    'marketPriceDate', v_market_date,
    'marketStale', (v_market_date is null or v_market_date <= v_today - 3)
  );
end;
$$;

revoke all on function public.get_dashboard_today(uuid) from public;
grant execute on function public.get_dashboard_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_dashboard_sales: has_org_role({owner,org_admin,seller}) ->
-- has_permission(dashboard,view). Same judgment call as get_dashboard_today.
-- Verbatim from 20260824000001_dashboard_sales_rpc.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_sales(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_len integer := (p_to - p_from) + 1;
  v_prev_from date;
  v_prev_to date := p_from - 1;
  v_kpis jsonb;
  v_prev jsonb;
  v_series jsonb;
  v_funnel jsonb;
  v_products jsonb;
  v_customers jsonb;
  v_zones jsonb;
begin
  if not public.has_permission(p_organization_id, 'dashboard', 'view') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_to < p_from or v_len > 400 then
    raise exception using errcode = 'P0001', message = 'invalid range';
  end if;
  if p_bucket not in ('day','week') then
    raise exception using errcode = 'P0001', message = 'invalid bucket';
  end if;

  v_prev_from := p_from - v_len;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;

  select jsonb_build_object(
    'revenue', coalesce(sum(o.total_amount), 0),
    'orders', count(*),
    'kg', coalesce((
      select sum(oi.final_weight_kg)
      from public.order_items oi
      join public.orders o2 on o2.id = oi.order_id
      where o2.organization_id = p_organization_id
        and o2.status in ('delivered','closed')
        and o2.delivery_date between p_from and p_to
        and not oi.is_cancelled
    ), 0))
  into v_kpis
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('delivered','closed')
    and o.delivery_date between p_from and p_to;

  select jsonb_build_object(
    'revenue', coalesce(sum(o.total_amount), 0),
    'orders', count(*),
    'kg', coalesce((
      select sum(oi.final_weight_kg)
      from public.order_items oi
      join public.orders o2 on o2.id = oi.order_id
      where o2.organization_id = p_organization_id
        and o2.status in ('delivered','closed')
        and o2.delivery_date between v_prev_from and v_prev_to
        and not oi.is_cancelled
    ), 0))
  into v_prev
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('delivered','closed')
    and o.delivery_date between v_prev_from and v_prev_to;

  select coalesce(jsonb_agg(
           jsonb_build_object('bucket', s.b, 'revenue', s.r, 'orders', s.n)
           order by s.b), '[]'::jsonb)
  into v_series
  from (
    select case when p_bucket = 'week'
                then date_trunc('week', o.delivery_date::timestamp)::date
                else o.delivery_date end as b,
           sum(o.total_amount) as r,
           count(*) as n
    from public.orders o
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by 1
  ) s;

  select coalesce(jsonb_object_agg(f.status, f.n), '{}'::jsonb)
  into v_funnel
  from (
    select o.status::text as status, count(*) as n
    from public.orders o
    where o.organization_id = p_organization_id
      and ((o.created_at at time zone v_tz)::date) between p_from and p_to
    group by o.status
  ) f;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'kg', t.kg)
           order by t.revenue desc), '[]'::jsonb)
  into v_products
  from (
    select p.name,
           sum(coalesce(oi.line_total, 0)) as revenue,
           sum(coalesce(oi.final_weight_kg, 0)) as kg
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
    group by p.name
    order by revenue desc
    limit 5
  ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'orders', t.n)
           order by t.revenue desc), '[]'::jsonb)
  into v_customers
  from (
    select c.name, sum(o.total_amount) as revenue, count(*) as n
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by c.name
    order by revenue desc
    limit 5
  ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'orders', t.n)
           order by t.revenue desc), '[]'::jsonb)
  into v_zones
  from (
    select z.name, sum(o.total_amount) as revenue, count(*) as n
    from public.orders o
    join public.delivery_zones z on z.id = o.zone_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by z.name
    order by revenue desc
    limit 5
  ) t;

  return jsonb_build_object(
    'kpis', v_kpis,
    'previous', v_prev,
    'series', v_series,
    'funnel', v_funnel,
    'topProducts', v_products,
    'topCustomers', v_customers,
    'topZones', v_zones
  );
end;
$$;

revoke all on function public.get_dashboard_sales(uuid, date, date, text) from public;
grant execute on function public.get_dashboard_sales(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_dashboard_insights: has_org_role({owner,org_admin,seller}) ->
-- has_permission(dashboard,view). Same judgment call as get_dashboard_today.
-- Verbatim from 20260827000006_dashboard_insights_weight_loss.sql except the
-- guard.
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_insights(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_today date;
  v_pricing jsonb;
  v_weight jsonb;
  v_retention jsonb;
  v_delivery jsonb;
begin
  if not public.has_permission(p_organization_id, 'dashboard', 'view') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_to < p_from or (p_to - p_from) + 1 > 400 then
    raise exception using errcode = 'P0001', message = 'invalid range';
  end if;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;
  v_today := (now() at time zone v_tz)::date;

  -- Realized RM/kg per product (delivered/closed, non-cancelled items).
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', t.name, 'kg', t.kg, 'revenue', t.revenue,
           'realizedPerKg', case when t.kg > 0 then round(t.revenue / t.kg, 2) else null end
         ) order by t.revenue desc), '[]'::jsonb)
  into v_pricing
  from (
    select p.name,
           sum(coalesce(oi.final_weight_kg, 0)) as kg,
           sum(coalesce(oi.line_total, 0)) as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
    group by p.name
    order by revenue desc
    limit 10
  ) t;

  -- Weight leakage: warehouse allocation vs final weighed, where both exist.
  -- lost* figures are loss-only (per item, gains ignored); RM valuation
  -- requires price_per_kg and rounds per item before summing.
  select jsonb_build_object(
    'warehouseKg', coalesce(sum(w.warehouse_kg), 0),
    'finalKg', coalesce(sum(w.final_kg), 0),
    'diffKg', coalesce(sum(w.warehouse_kg - w.final_kg), 0),
    'lostKg', coalesce(sum(w.lost_kg), 0),
    'lostRm', coalesce(sum(w.lost_rm), 0),
    'byProduct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', w2.name, 'warehouseKg', w2.warehouse_kg, 'finalKg', w2.final_kg,
        'diffKg', w2.warehouse_kg - w2.final_kg,
        'lostKg', w2.lost_kg, 'lostRm', w2.lost_rm)
        order by w2.lost_rm desc, w2.lost_kg desc)
      from (
        select p.name,
               sum(oi.warehouse_weight_kg) as warehouse_kg,
               sum(oi.final_weight_kg) as final_kg,
               sum(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0)) as lost_kg,
               sum(case when oi.price_per_kg is not null
                     then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                     else 0 end) as lost_rm
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
          and o.delivery_date between p_from and p_to
          and not oi.is_cancelled
          and oi.warehouse_weight_kg is not null
          and oi.final_weight_kg is not null
        group by p.name
        order by lost_rm desc, lost_kg desc
        limit 5
      ) w2), '[]'::jsonb),
    'byOrder', coalesce((
      select jsonb_agg(jsonb_build_object(
        'orderId', w3.order_id, 'customerName', w3.customer_name,
        'deliveryDate', w3.delivery_date,
        'lostKg', w3.lost_kg, 'lostRm', w3.lost_rm)
        order by w3.lost_rm desc, w3.lost_kg desc)
      from (
        select o.id as order_id, c.name as customer_name, o.delivery_date,
               sum(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0)) as lost_kg,
               sum(case when oi.price_per_kg is not null
                     then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                     else 0 end) as lost_rm
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.customers c on c.id = o.customer_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
          and o.delivery_date between p_from and p_to
          and not oi.is_cancelled
          and oi.warehouse_weight_kg is not null
          and oi.final_weight_kg is not null
        group by o.id, c.name, o.delivery_date
        having sum(case when oi.price_per_kg is not null
                     then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                     else 0 end) > 0
        order by lost_rm desc, lost_kg desc
        limit 10
      ) w3), '[]'::jsonb))
  into v_weight
  from (
    select sum(oi.warehouse_weight_kg) as warehouse_kg,
           sum(oi.final_weight_kg) as final_kg,
           sum(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0)) as lost_kg,
           sum(case when oi.price_per_kg is not null
                 then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                 else 0 end) as lost_rm
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
      and oi.warehouse_weight_kg is not null
      and oi.final_weight_kg is not null
  ) w;

  -- Retention: customers active in range, split new vs returning; silent =
  -- customers whose last delivered/closed order is 30+ days before today.
  select jsonb_build_object(
    'active', (
      select count(distinct o.customer_id) from public.orders o
      where o.organization_id = p_organization_id
        and o.status in ('delivered','closed')
        and o.delivery_date between p_from and p_to),
    'newCustomers', (
      select count(*) from (
        select o.customer_id, min(o.delivery_date) as first_date
        from public.orders o
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
        group by o.customer_id
      ) fc where fc.first_date between p_from and p_to),
    'returning', (
      select count(distinct o.customer_id) from public.orders o
      where o.organization_id = p_organization_id
        and o.status in ('delivered','closed')
        and o.delivery_date between p_from and p_to
        and exists (
          select 1 from public.orders prior
          where prior.organization_id = p_organization_id
            and prior.customer_id = o.customer_id
            and prior.status in ('delivered','closed')
            and prior.delivery_date < p_from)),
    'silent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'lastOrderDate', s.last_date, 'lifetimeRevenue', s.revenue)
        order by s.revenue desc)
      from (
        select c.name, max(o.delivery_date) as last_date, sum(o.total_amount) as revenue
        from public.orders o
        join public.customers c on c.id = o.customer_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
        group by c.id, c.name
        having max(o.delivery_date) < v_today - 30
        order by sum(o.total_amount) desc
        limit 10
      ) s), '[]'::jsonb))
  into v_retention;

  -- Delivery quality: attempts in range by org-timezone day, plus slot fill.
  select jsonb_build_object(
    'attempts', count(*),
    'failed', count(*) filter (where da.outcome = 'failed'),
    'byZone', coalesce((
      select jsonb_agg(jsonb_build_object('zone', z.name, 'total', z.total, 'failed', z.failed)
               order by z.failed desc)
      from (
        select dz.name, count(*) as total,
               count(*) filter (where da2.outcome = 'failed') as failed
        from public.delivery_attempts da2
        join public.orders o2 on o2.id = da2.order_id
        join public.delivery_zones dz on dz.id = o2.zone_id
        where da2.organization_id = p_organization_id
          and ((da2.attempted_at at time zone v_tz)::date) between p_from and p_to
        group by dz.name
      ) z), '[]'::jsonb),
    'slotOrders', (
      select count(*) from public.orders o
      where o.organization_id = p_organization_id
        and o.status <> 'cancelled'
        and o.delivery_date between p_from and p_to),
    'slotCapacity', coalesce((
      select sum(ds.max_orders)
      from public.delivery_slots ds
      join generate_series(p_from, p_to, interval '1 day') d
        on extract(dow from d)::smallint = ds.weekday
      where ds.organization_id = p_organization_id
        and ds.is_active
        and ds.max_orders is not null), 0))
  into v_delivery
  from public.delivery_attempts da
  where da.organization_id = p_organization_id
    and ((da.attempted_at at time zone v_tz)::date) between p_from and p_to;

  return jsonb_build_object(
    'pricing', v_pricing,
    'weight', v_weight,
    'retention', v_retention,
    'delivery', v_delivery
  );
end;
$$;

revoke all on function public.get_dashboard_insights(uuid, date, date) from public;
grant execute on function public.get_dashboard_insights(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- leave_available: (self OR has_org_role({owner,org_admin,hr})) ->
-- (self OR has_permission(leave_management,view)); self-branch kept verbatim.
-- Verbatim from 20260830000003_hr_leave_hardening.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.leave_available(
  p_org uuid, p_user uuid, p_type uuid, p_year int, p_as_of date,
  p_exclude uuid default null
)
returns table (available numeric, cf_remaining numeric)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement numeric;
  v_accrual text;
  v_accrued numeric;
  v_cf numeric;
  v_credits numeric;
  v_cf_used numeric;
  v_base_used numeric;
  v_pending numeric;
begin
  if not (p_user = auth.uid()
          or public.has_permission(p_org, 'leave_management', 'view')) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select entitlement_days, accrual into v_entitlement, v_accrual
  from public.leave_types where id = p_type and organization_id = p_org;

  if v_entitlement is null then
    -- upon-request type: unlimited
    return query select null::numeric, 0::numeric;
    return;
  end if;

  v_accrued := case when v_accrual = 'pro_rata'
    then round(v_entitlement * extract(month from p_as_of) / 12.0, 2)
    else v_entitlement end;

  select coalesce(sum(days), 0) into v_cf
  from public.leave_ledger
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year
    and kind = 'carry_forward'
    and (expires_on is null or expires_on >= p_as_of);

  select coalesce(sum(days), 0) into v_credits
  from public.leave_ledger
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year
    and kind in ('credit','adjustment')
    and (expires_on is null or expires_on >= p_as_of);

  select coalesce(sum((breakdown->>'carry_forward_used')::numeric), 0),
         coalesce(sum((breakdown->>'base_used')::numeric), 0)
    into v_cf_used, v_base_used
  from public.leave_requests
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year and status = 'approved';

  select coalesce(sum(day_count), 0) into v_pending
  from public.leave_requests
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year and status = 'pending'
    and (p_exclude is null or id <> p_exclude);

  return query select
    greatest(v_cf - v_cf_used, 0) + v_accrued + v_credits - v_base_used - v_pending,
    greatest(v_cf - v_cf_used, 0);
end;
$$;
revoke all on function public.leave_available(uuid, uuid, uuid, int, date, uuid) from public;
grant execute on function public.leave_available(uuid, uuid, uuid, int, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_leave_request: has_org_role({owner,org_admin,hr}) ->
-- has_permission(leave_management,edit). Verbatim from
-- 20260830000002_hr_leave_rpcs.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.approve_leave_request(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_avail numeric;
  v_cf_rem numeric;
  v_cf_used numeric;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_permission(r.organization_id, 'leave_management', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  -- Serialize decisions per (org, user, type, year): two approvers acting on
  -- different requests of the same member would otherwise both read the same
  -- cf_remaining and double-allocate carry-forward.
  perform pg_advisory_xact_lock(
    hashtextextended(r.organization_id::text || ':' || r.user_id::text || ':'
                     || r.leave_type_id::text || ':' || r.year::text, 0));

  select available, cf_remaining into v_avail, v_cf_rem
  from public.leave_available(
    r.organization_id, r.user_id, r.leave_type_id, r.year, r.start_date, r.id);

  -- v_avail null = upon-request type: always approvable.
  if v_avail is not null and v_avail < r.day_count then
    raise exception using errcode = 'P0001', message = 'insufficient_balance';
  end if;

  v_cf_used := case when v_avail is null then 0
    else least(coalesce(v_cf_rem, 0), r.day_count) end;

  update public.leave_requests
  set status = 'approved',
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = p_note,
      breakdown = jsonb_build_object(
        'carry_forward_used', v_cf_used,
        'base_used', r.day_count - v_cf_used)
  where id = p_request;
end;
$$;
revoke all on function public.approve_leave_request(uuid, text) from public;
grant execute on function public.approve_leave_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_leave_request: has_org_role({owner,org_admin,hr}) ->
-- has_permission(leave_management,edit). Verbatim from
-- 20260830000002_hr_leave_rpcs.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.reject_leave_request(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_permission(r.organization_id, 'leave_management', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  update public.leave_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request;
end;
$$;
revoke all on function public.reject_leave_request(uuid, text) from public;
grant execute on function public.reject_leave_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_leave_credit: has_org_role({owner,org_admin,hr}) ->
-- has_permission(leave_management,edit). Verbatim from
-- 20260830000002_hr_leave_rpcs.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.approve_leave_credit(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.leave_credit_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_permission(r.organization_id, 'leave_management', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  update public.leave_credit_requests
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request;

  insert into public.leave_ledger
    (organization_id, user_id, leave_type_id, year, kind, days, expires_on, note, created_by)
  values
    (r.organization_id, r.user_id, r.leave_type_id,
     extract(year from r.reference_start)::int, 'credit', r.amount,
     make_date(extract(year from r.reference_start)::int, 12, 31),
     'credit request ' || r.id, auth.uid());
end;
$$;
revoke all on function public.approve_leave_credit(uuid, text) from public;
grant execute on function public.approve_leave_credit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_leave_credit: has_org_role({owner,org_admin,hr}) ->
-- has_permission(leave_management,edit). Verbatim from
-- 20260830000002_hr_leave_rpcs.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.reject_leave_credit(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.leave_credit_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_permission(r.organization_id, 'leave_management', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  update public.leave_credit_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request;
end;
$$;
revoke all on function public.reject_leave_credit(uuid, text) from public;
grant execute on function public.reject_leave_credit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- close_leave_year: has_org_role({owner,org_admin,hr}) ->
-- has_permission(leave_management,edit). Verbatim from
-- 20260830000002_hr_leave_rpcs.sql except the guard.
-- ---------------------------------------------------------------------------
create or replace function public.close_leave_year(p_org uuid, p_year int)
returns integer
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_type record;
  v_member record;
  v_avail numeric;
  v_cf_rem numeric;
  v_carry numeric;
  v_count integer := 0;
  v_inserted integer;
begin
  if not public.has_permission(p_org, 'leave_management', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  -- Serialize year-close runs per org/year: the idempotency check below
  -- (exists ... continue) races against a concurrent close_leave_year call
  -- without this lock; the unique index is the hard backstop underneath it.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_year::text, 0));

  for v_type in
    select id, carry_forward_cap from public.leave_types
    where organization_id = p_org and carry_forward_cap is not null
      and entitlement_days is not null
  loop
    for v_member in
      select user_id from public.organization_members
      where organization_id = p_org and status = 'active'
    loop
      if exists (
        select 1 from public.leave_ledger
        where organization_id = p_org and user_id = v_member.user_id
          and leave_type_id = v_type.id and year = p_year + 1
          and kind = 'carry_forward'
      ) then continue; end if;

      -- as-of 31 Dec: full accrual, expired CF already excluded.
      -- Pending requests still hold balance here: clear the approval queue
      -- before closing the year, or the held days are excluded from
      -- carry-forward permanently.
      select available into v_avail
      from public.leave_available(
        p_org, v_member.user_id, v_type.id, p_year, make_date(p_year, 12, 31));

      v_carry := least(greatest(coalesce(v_avail, 0), 0), v_type.carry_forward_cap);
      if v_carry <= 0 then continue; end if;

      insert into public.leave_ledger
        (organization_id, user_id, leave_type_id, year, kind, days, expires_on, note, created_by)
      values
        (p_org, v_member.user_id, v_type.id, p_year + 1, 'carry_forward', v_carry,
         make_date(p_year + 1, 10, 31), 'year close ' || p_year, auth.uid())
      on conflict (organization_id, user_id, leave_type_id, year)
        where kind = 'carry_forward'
        do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted > 0 then v_count := v_count + 1; end if;
    end loop;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.close_leave_year(uuid, int) from public;
grant execute on function public.close_leave_year(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Step 1 (RLS): drop + recreate each policy below with the new using/check.
-- Bodies are otherwise verbatim from their source migration.
-- ---------------------------------------------------------------------------

-- organizations (source: 20260624000002_id_access_rls.sql)
drop policy if exists organizations_update_owner on public.organizations;
create policy organizations_update_owner
  on public.organizations for update to authenticated
  using (public.has_permission(id, 'organization.manage', 'use'))
  with check (public.has_permission(id, 'organization.manage', 'use'));

drop policy if exists organizations_delete_owner on public.organizations;
create policy organizations_delete_owner
  on public.organizations for delete to authenticated
  using (public.has_permission(id, 'organization.manage', 'use'));

-- organization_members (source: 20260624000002_id_access_rls.sql)
drop policy if exists org_members_insert_admin on public.organization_members;
create policy org_members_insert_admin
  on public.organization_members for insert to authenticated
  with check (
    public.has_permission(organization_id, 'membership.role.change', 'use')
    and public.role_rank(role) <= public.role_rank((
      select m.role from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
      limit 1
    ))
  );

drop policy if exists org_members_update_admin on public.organization_members;
create policy org_members_update_admin
  on public.organization_members for update to authenticated
  using (public.has_permission(organization_id, 'membership.role.change', 'use'))
  with check (
    public.has_permission(organization_id, 'membership.role.change', 'use')
    and public.role_rank(role) <= public.role_rank((
      select m.role from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
      limit 1
    ))
  );

-- member_scopes (source: 20260624000002_id_access_rls.sql). Drops the legacy
-- 'farm_manager' role name that the old array literal carried.
drop policy if exists member_scopes_admin_write on public.member_scopes;
create policy member_scopes_admin_write
  on public.member_scopes for all to authenticated
  using (public.has_permission(organization_id, 'membership.scope.change', 'use'))
  with check (public.has_permission(organization_id, 'membership.scope.change', 'use'));

-- invitations (source: 20260624000002_id_access_rls.sql). Invitee OR-branch
-- on the select policy is kept verbatim.
drop policy if exists invitations_select_admin_or_invitee on public.invitations;
create policy invitations_select_admin_or_invitee
  on public.invitations for select to authenticated
  using (
    public.has_permission(organization_id, 'membership.invite', 'use')
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists invitations_insert_admin on public.invitations;
create policy invitations_insert_admin
  on public.invitations for insert to authenticated
  with check (
    public.has_permission(organization_id, 'membership.invite', 'use')
    and public.role_rank(role) <= public.role_rank((
      select m.role from public.organization_members m
      where m.organization_id = invitations.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
      limit 1
    ))
  );

drop policy if exists invitations_revoke_admin on public.invitations;
create policy invitations_revoke_admin
  on public.invitations for update to authenticated
  using (public.has_permission(organization_id, 'membership.invite', 'use'))
  with check (
    public.has_permission(organization_id, 'membership.invite', 'use')
    -- Inviter can only set revoked_at; other fields are frozen by trigger
    -- in migration 03.
  );

-- access_reviews / access_review_items (source: 20260624000002_id_access_rls.sql).
-- Subject OR-branches are kept verbatim.
drop policy if exists access_reviews_select_admin on public.access_reviews;
create policy access_reviews_select_admin
  on public.access_reviews for select to authenticated
  using (public.has_permission(organization_id, 'access_review.run', 'use'));

drop policy if exists access_reviews_admin_write on public.access_reviews;
create policy access_reviews_admin_write
  on public.access_reviews for all to authenticated
  using (public.has_permission(organization_id, 'access_review.run', 'use'))
  with check (public.has_permission(organization_id, 'access_review.run', 'use'));

drop policy if exists access_review_items_select_admin_or_subject on public.access_review_items;
create policy access_review_items_select_admin_or_subject
  on public.access_review_items for select to authenticated
  using (
    public.has_permission((
      select m.organization_id
      from public.organization_members m
      where m.id = organization_member_id
    ), 'access_review.run', 'use')
    or organization_member_id in (
      select id from public.organization_members
      where user_id = (select auth.uid())
    )
  );

-- Reviewer-flagged fix (Importance, not in the brief's map): the original
-- with_check carried only the self-exclusion, no role check at all. On a
-- permissive FOR ALL policy the with_check clause alone governs INSERT, so
-- any authenticated user -- not just an access-review admin -- could insert
-- access_review_items rows. AND the same has_permission check used in the
-- USING clause (same org resolution) into the with_check alongside the
-- pre-existing self-exclusion; the USING clause itself is unchanged.
drop policy if exists access_review_items_admin_write on public.access_review_items;
create policy access_review_items_admin_write
  on public.access_review_items for all to authenticated
  using (public.has_permission((
    select m.organization_id
    from public.organization_members m
    where m.id = organization_member_id
  ), 'access_review.run', 'use'))
  with check (
    public.has_permission((
      select m.organization_id
      from public.organization_members m
      where m.id = organization_member_id
    ), 'access_review.run', 'use')
    and organization_member_id <> (
      select m.id from public.organization_members m
      where m.user_id = (select auth.uid())
      and m.status = 'active'
      limit 1
    )
  );

-- leave_types / public_holidays / leave_ledger approver write (source:
-- 20260830000001_hr_leave_schema.sql)
drop policy if exists "leave_types_approver_write" on public.leave_types;
create policy "leave_types_approver_write" on public.leave_types
  for all to authenticated
  using (public.has_permission(organization_id, 'leave_management', 'edit'))
  with check (public.has_permission(organization_id, 'leave_management', 'edit'));

drop policy if exists "public_holidays_approver_write" on public.public_holidays;
create policy "public_holidays_approver_write" on public.public_holidays
  for all to authenticated
  using (public.has_permission(organization_id, 'leave_management', 'edit'))
  with check (public.has_permission(organization_id, 'leave_management', 'edit'));

drop policy if exists "leave_ledger_approver_all" on public.leave_ledger;
create policy "leave_ledger_approver_all" on public.leave_ledger
  for all to authenticated
  using (public.has_permission(organization_id, 'leave_management', 'edit'))
  with check (public.has_permission(organization_id, 'leave_management', 'edit'));

-- leave_requests / leave_credit_requests approver read (source:
-- 20260830000001_hr_leave_schema.sql)
drop policy if exists "leave_requests_approver_read" on public.leave_requests;
create policy "leave_requests_approver_read" on public.leave_requests
  for select to authenticated
  using (public.has_permission(organization_id, 'leave_management', 'view'));

drop policy if exists "leave_credit_requests_approver_read" on public.leave_credit_requests;
create policy "leave_credit_requests_approver_read" on public.leave_credit_requests
  for select to authenticated
  using (public.has_permission(organization_id, 'leave_management', 'view'));

-- ---------------------------------------------------------------------------
-- has_org_role: deprecated shim over role_id, kept so any straggler caller
-- keeps working until Task 13 removes it. Exact SQL from the brief.
-- ---------------------------------------------------------------------------
create or replace function has_org_role(target_org uuid, roles text[])
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (
    select 1 from organization_members m
    join organization_roles r on r.id = m.role_id
    where m.organization_id = target_org and m.user_id = auth.uid()
      and m.status = 'active' and (m.expires_at is null or m.expires_at > now())
      and r.key = any(roles)
  );
$$;

revoke all on function public.has_org_role(uuid, text[]) from public;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

commit;
