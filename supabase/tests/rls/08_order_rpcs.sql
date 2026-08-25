-- supabase/tests/rls/08_order_rpcs.sql
-- Order lifecycle RPC behavior: place_order (happy path, slot_full,
-- weekday_mismatch), confirm_order (fallback applied, cancel-fallback
-- cancels the order), complete_order_task (ready + weight log),
-- close_order (total + manager-only), cancel_order (buyer while pending
-- only), reopen_order (org_admin only).

begin;

select plan(66);

create temporary table _scratch (label text primary key, order_id uuid);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('b0000000-0000-0000-0000-00000000000a', 'order-rpc-test-org', 'Order RPC Test Org')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('b0000000-0000-0000-0000-000000000001'), -- owner
  ('b0000000-0000-0000-0000-000000000002'), -- org_admin
  ('b0000000-0000-0000-0000-000000000003'), -- inventory
  ('b0000000-0000-0000-0000-000000000004')  -- buyer
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000002', 'org_admin', 'active'),
  ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000003', 'inventory', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.buyers (id, organization_id, display_name, phone)
values ('b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'RPC Buyer', null)
on conflict (id) do nothing;

insert into public.categories (id, organization_id, name)
values ('b0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Whole Chicken')
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, is_active)
values ('b0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000005', 'Whole Chicken', true)
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, created_by)
values ('b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'RPC Zone', 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('b0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'RPC Truck', 'RPC-A', 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.truck_zones (truck_id, zone_id, organization_id)
values ('b0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a')
on conflict do nothing;

-- Capacity-1 slot, used only for the slot_full scenario.
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, max_orders, created_by)
values (
  'b0000000-0000-0000-0000-000000000009',
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-000000000008',
  extract(dow from current_date + 1)::smallint,
  '09:00', '12:00', 1,
  'b0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

-- Unlimited-capacity slot with the wrong weekday, used only for the
-- weekday_mismatch scenario (it still covers the zone and is active, so it
-- passes the slot_not_found lookup and fails specifically on weekday).
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values (
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-000000000008',
  ((extract(dow from current_date + 1)::int + 1) % 7)::smallint,
  '09:00', '12:00',
  'b0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

-- Unlimited-capacity slot with the right weekday, used for every other
-- scenario so it never collides with the capacity-1 slot above.
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values (
  'b0000000-0000-0000-0000-00000000000b',
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-000000000008',
  extract(dow from current_date + 1)::smallint,
  '14:00', '17:00',
  'b0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

-- Isolated fixtures for get_delivery_options coverage: a second and third
-- truck, both covering zone007 but never touched by place_order, so their
-- capacity/date math can be asserted independently of the order-lifecycle
-- scenarios above.
insert into public.trucks (id, organization_id, name, code, created_by)
values
  ('b0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000000a', 'Options Truck 2', 'RPC-B', 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-00000000000a', 'Options Truck 3', 'RPC-C', 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.truck_zones (truck_id, zone_id, organization_id)
values
  ('b0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a')
on conflict do nothing;

-- Capacity-2 slot on the matching weekday, never ordered against: proves
-- "seeded slot appears with expected remaining" and, once blocked below,
-- "a schedule_block removes the date".
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, max_orders, created_by)
values (
  'b0000000-0000-0000-0000-00000000000d',
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-00000000000c',
  extract(dow from current_date + 1)::smallint,
  '07:00', '07:30', 2,
  'b0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

-- Unlimited-capacity slot one weekday off the others: proves weekday
-- filtering (it must only ever appear on its own matching dates).
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values (
  'b0000000-0000-0000-0000-00000000000e',
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-00000000000c',
  ((extract(dow from current_date + 1)::int + 1) % 7)::smallint,
  '10:00', '10:30',
  'b0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

-- Capacity-1 slot on a third truck, pre-consumed by a directly-inserted
-- order fixture (bypassing place_order, since only the resulting capacity
-- state matters here): proves "capacity-full slot excluded".
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, max_orders, created_by)
values (
  'b0000000-0000-0000-0000-000000000010',
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-00000000000f',
  extract(dow from current_date + 1)::smallint,
  '11:00', '11:30', 1,
  'b0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('b0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'Fixture Customer', '0000000000', 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.orders (
  id, organization_id, customer_id, created_by, source, status,
  zone_id, delivery_address, delivery_date, slot_id, truck_id
) values (
  'b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000011',
  'b0000000-0000-0000-0000-000000000001', 'manual', 'pending',
  'b0000000-0000-0000-0000-000000000007', 'Fixture St', current_date + 1,
  'b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000f'
)
on conflict (id) do nothing;

-- Isolated fixtures for set_run_status coverage: a fourth truck with its own
-- delivery_runs row and a directly-inserted 'ready' order riding on it, kept
-- separate from the order-lifecycle scenarios above so their status
-- transitions can't collide with this run's planned -> departed -> completed
-- walk.
insert into public.trucks (id, organization_id, name, code, created_by)
values ('b0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-00000000000a', 'Run Truck', 'RPC-D', 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
values ('b0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000013', current_date + 1, 'planned')
on conflict (id) do nothing;

insert into public.orders (
  id, organization_id, customer_id, created_by, source, status,
  zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id
) values (
  'b0000000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000011',
  'b0000000-0000-0000-0000-000000000001', 'manual', 'ready',
  'b0000000-0000-0000-0000-000000000007', 'Run Fixture St', current_date + 1,
  'b0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000014'
)
on conflict (id) do nothing;

grant select, insert on _scratch to authenticated;

-- ---------------------------------------------------------------------------
-- 1. place_order: happy path (portal buyer, capacity-1 slot)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'happy', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-000000000009'::uuid,
      current_date + 1,
      '1 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":2.5,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'place_order happy path (portal buyer) succeeds'
);

reset role;

select results_eq(
  $$ select status::text, source from public.orders where id = (select order_id from _scratch where label = 'happy') $$,
  $$ values ('pending'::text, 'portal'::text) $$,
  'happy-path order is pending/portal'
);

select results_eq(
  $$ select c.name, c.phone from public.customers c join public.buyers b on b.customer_id = c.id where b.id = 'b0000000-0000-0000-0000-000000000004' $$,
  $$ values ('RPC Buyer'::text, '-----'::text) $$,
  'buyer customer_id link auto-created with coalesced phone'
);

-- ---------------------------------------------------------------------------
-- 2. place_order: slot_full (capacity 1, already consumed above)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-000000000009'::uuid,
      current_date + 1,
      '2 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"piece","quantity":3,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'slot_full',
  'place_order rejects a second order on a full slot'
);

reset role;

-- ---------------------------------------------------------------------------
-- 3. place_order: weekday_mismatch
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      current_date + 1,
      '3 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"piece","quantity":3,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'weekday_mismatch',
  'place_order rejects a date that does not match the slot weekday'
);

reset role;

-- ---------------------------------------------------------------------------
-- 4. confirm_order: fallback applied (mix survives, cancel-line cancels)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'confirm', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '4 Test Street',
      null,
      '[
        {"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":3.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"},
        {"productId":"b0000000-0000-0000-0000-000000000006","mode":"piece","quantity":2,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"cancel"}
      ]'::jsonb
    )
  $$,
  'seed: place a 2-line order for the confirm_order scenario'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'confirm'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'available', false))
        from public.order_items where order_id = (select order_id from _scratch where label = 'confirm')
      )
    )
  $$,
  'P0001', 'invalid_price',
  'confirm_order rejects a surviving (mix-fallback) line without a price_per_kg'
);

select lives_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'confirm'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'available', false, 'price_per_kg', 12.0))
        from public.order_items where order_id = (select order_id from _scratch where label = 'confirm')
      )
    )
  $$,
  'manager confirms the order, marking every line unavailable'
);

reset role;

select results_eq(
  $$ select price_per_kg from public.order_items where order_id = (select order_id from _scratch where label = 'confirm') and fallback = 'mix' $$,
  $$ values (12.0::numeric) $$,
  'confirm stores price_per_kg on the surviving line'
);

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

reset role;

select results_eq(
  $$ select fallback_applied::text, is_cancelled from public.order_items where order_id = (select order_id from _scratch where label = 'confirm') and fallback = 'mix' $$,
  $$ values ('mix'::text, false) $$,
  'mix-fallback line survives, not cancelled'
);

select results_eq(
  $$ select is_cancelled from public.order_items where order_id = (select order_id from _scratch where label = 'confirm') and fallback = 'cancel' $$,
  $$ values (true) $$,
  'cancel-fallback line is cancelled'
);

select results_eq(
  $$ select status::text from public.orders where id = (select order_id from _scratch where label = 'confirm') $$,
  $$ values ('confirmed'::text) $$,
  'order is confirmed (not every line cancelled)'
);

select results_eq(
  $$ select status::text from public.order_tasks where order_id = (select order_id from _scratch where label = 'confirm') $$,
  $$ values ('pending'::text) $$,
  'confirming creates the allocate_weigh task'
);

-- ---------------------------------------------------------------------------
-- 5. confirm_order: every line cancelled cancels the order
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'allcancel', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '5 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"cancel"}]'::jsonb
    )
  $$,
  'seed: place a single cancel-fallback line order'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'allcancel'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'available', false))
        from public.order_items where order_id = (select order_id from _scratch where label = 'allcancel')
      )
    )
  $$,
  'manager confirms the single-line order as unavailable'
);

reset role;

select results_eq(
  $$ select status::text from public.orders where id = (select order_id from _scratch where label = 'allcancel') $$,
  $$ values ('cancelled'::text) $$,
  'order with every line cancel-fallback is itself cancelled'
);

-- ---------------------------------------------------------------------------
-- 6. complete_order_task: sets ready + writes a warehouse weight log row
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000003';

select lives_ok(
  $$
    select public.complete_order_task(
      (select id from public.order_tasks where order_id = (select order_id from _scratch where label = 'confirm')),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'weight_kg', 3.2, 'pieces', 2))
        from public.order_items
        where order_id = (select order_id from _scratch where label = 'confirm') and is_cancelled = false
      )
    )
  $$,
  'inventory-role staff completes the allocate_weigh task'
);

reset role;

select results_eq(
  $$ select status::text from public.orders where id = (select order_id from _scratch where label = 'confirm') $$,
  $$ values ('ready'::text) $$,
  'order moves to ready once the task is done'
);

select results_eq(
  $$ select kind::text, weight_kg from public.order_weight_log where order_item_id = (select id from public.order_items where order_id = (select order_id from _scratch where label = 'confirm') and fallback = 'mix') $$,
  $$ values ('warehouse'::text, 3.2::numeric) $$,
  'warehouse weight log row recorded'
);

-- ---------------------------------------------------------------------------
-- 7. close_order: blocks non-manager, then computes the total
-- ---------------------------------------------------------------------------
update public.orders set status = 'delivered' where id = (select order_id from _scratch where label = 'confirm');

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000003';

select throws_ok(
  $$
    select public.close_order(
      (select order_id from _scratch where label = 'confirm'),
      '[]'::jsonb
    )
  $$,
  'P0001', 'forbidden',
  'inventory-role staff cannot close an order'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    select public.close_order(
      (select order_id from _scratch where label = 'confirm'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'final_weight_kg', 3.0, 'final_pieces', 2))
        from public.order_items
        where order_id = (select order_id from _scratch where label = 'confirm') and is_cancelled = false
      )
    )
  $$,
  'manager closes the order without re-keying price (confirm-time price stands)'
);

reset role;

select results_eq(
  $$ select status::text, total_amount from public.orders where id = (select order_id from _scratch where label = 'confirm') $$,
  $$ values ('closed'::text, 36.00::numeric) $$,
  'closing computes total_amount = final_weight_kg * confirm-time price_per_kg'
);

-- ---------------------------------------------------------------------------
-- 8. cancel_order: buyer can cancel their own order only while pending
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'cancel_pending', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '8 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'seed: place a pending order for the cancel_order scenario'
);

select lives_ok(
  $$ select public.cancel_order((select order_id from _scratch where label = 'cancel_pending'), 'changed my mind') $$,
  'buyer cancels their own pending order'
);

reset role;

select results_eq(
  $$ select status::text from public.orders where id = (select order_id from _scratch where label = 'cancel_pending') $$,
  $$ values ('cancelled'::text) $$,
  'buyer cancel while pending sets status to cancelled'
);

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select throws_ok(
  $$ select public.cancel_order((select order_id from _scratch where label = 'allcancel'), 'too late') $$,
  'P0001', 'invalid_status',
  'buyer cannot cancel an order that is no longer pending'
);

reset role;

-- ---------------------------------------------------------------------------
-- 9. reopen_order: org_admin/owner only, audit-logged
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.reopen_order((select order_id from _scratch where label = 'confirm'), 'customer disputed weight') $$,
  'P0001', 'forbidden',
  'inventory-role staff cannot reopen a closed order'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select public.reopen_order((select order_id from _scratch where label = 'confirm'), 'customer disputed weight') $$,
  'org_admin reopens the closed order'
);

reset role;

select results_eq(
  $$ select status::text, closed_at is null from public.orders where id = (select order_id from _scratch where label = 'confirm') $$,
  $$ values ('delivered'::text, true) $$,
  'reopen sets status back to delivered and clears closed_at'
);

select ok(
  (select count(*) = 1 from public.audit_log where entity_type = 'order' and event_type = 'order.reopened' and entity_id = (select order_id from _scratch where label = 'confirm')),
  'reopen writes an audit_log row'
);

-- ---------------------------------------------------------------------------
-- 10. get_delivery_options: window/weekday/capacity/block behavior
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select option_date, remaining from public.get_delivery_options('b0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-000000000007'::uuid) where slot_id = 'b0000000-0000-0000-0000-00000000000d'::uuid order by option_date $$,
  $$ values (current_date + 1, 2::integer), (current_date + 8, 2::integer) $$,
  'get_delivery_options: a seeded slot appears on both matching dates in the 14-day window with expected remaining capacity'
);

select results_eq(
  $$ select option_date from public.get_delivery_options('b0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-000000000007'::uuid) where slot_id = 'b0000000-0000-0000-0000-00000000000e'::uuid order by option_date $$,
  $$ values (current_date + 2), (current_date + 9) $$,
  'get_delivery_options: a slot on a different weekday only appears on its own matching dates'
);

select results_eq(
  $$ select option_date, remaining from public.get_delivery_options('b0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-000000000007'::uuid) where slot_id = 'b0000000-0000-0000-0000-000000000010'::uuid order by option_date $$,
  $$ values (current_date + 8, 1::integer) $$,
  'get_delivery_options: a slot already at capacity on one date is excluded there but still offered on its next matching date'
);

insert into public.schedule_blocks (organization_id, block_date, truck_id, created_by)
values ('b0000000-0000-0000-0000-00000000000a', current_date + 8, 'b0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-000000000001');

select results_eq(
  $$ select option_date, remaining from public.get_delivery_options('b0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-000000000007'::uuid) where slot_id = 'b0000000-0000-0000-0000-00000000000d'::uuid order by option_date $$,
  $$ values (current_date + 1, 2::integer) $$,
  'get_delivery_options: a schedule_block on the truck removes just that date, leaving the other matching date'
);

-- ---------------------------------------------------------------------------
-- 10b. get_delivery_options: storefront read (2026-08-23 -- Terus Segar
-- wall-free checkout). Slot availability is data any freely-created buyer
-- account could already see, so the old buyer/member guard is dropped;
-- delivery options now succeed for a caller who is neither a buyer nor a
-- member of p_org, for an active buyer, and for an active org member.
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('b0000000-0000-0000-0000-000000000017') -- stranger: no organization_members row, no buyers row
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000017';

select lives_ok(
  $$ select * from public.get_delivery_options('b0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-000000000007'::uuid) $$,
  'get_delivery_options succeeds for a caller who is neither a buyer nor a member of the org (storefront read)'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$ select * from public.get_delivery_options('b0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-000000000007'::uuid) $$,
  'get_delivery_options still works for an active buyer of the org'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select * from public.get_delivery_options('b0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-000000000007'::uuid) $$,
  'get_delivery_options still works for an active org member'
);

reset role;

-- ---------------------------------------------------------------------------
-- 11. set_run_status: planned -> departed -> completed, flips ready orders
-- to delivered on completion, and rejects completed -> departed.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.set_run_status('b0000000-0000-0000-0000-000000000014'::uuid, 'departed'::public.delivery_run_status) $$,
  'manager departs a planned run (planned -> departed is legal)'
);

select lives_ok(
  $$ select public.set_run_status('b0000000-0000-0000-0000-000000000014'::uuid, 'completed'::public.delivery_run_status) $$,
  'manager completes a departed run (departed -> completed is legal)'
);

reset role;

select results_eq(
  $$ select status::text from public.orders where id = 'b0000000-0000-0000-0000-000000000015' $$,
  $$ values ('delivered'::text) $$,
  'completing a run flips its ready orders to delivered'
);

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.set_run_status('b0000000-0000-0000-0000-000000000014'::uuid, 'departed'::public.delivery_run_status) $$,
  'P0001', 'invalid_transition',
  'a completed run cannot transition back to departed'
);

reset role;

-- ---------------------------------------------------------------------------
-- 11b. set_run_status: completed -> completed re-fire (finding #4). A new
-- order can still be confirmed onto an already-completed run (confirm_order
-- never checks run status) and reach 'ready'; without the idempotent
-- re-fire case that order would be stuck at 'ready' forever. A fresh slot
-- on the same truck+date as run 014 (already completed above) proves the
-- upsert-by-(truck_id, run_date) reattaches to the existing run.
-- ---------------------------------------------------------------------------
insert into public.truck_zones (truck_id, zone_id, organization_id)
values ('b0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a')
on conflict do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values (
  'b0000000-0000-0000-0000-000000000018',
  'b0000000-0000-0000-0000-00000000000a',
  'b0000000-0000-0000-0000-000000000013',
  extract(dow from current_date + 1)::smallint,
  '20:00', '21:00',
  'b0000000-0000-0000-0000-000000000001'
)
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'late_on_completed_run', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-000000000018'::uuid,
      current_date + 1,
      '17 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'seed: place an order on the Run Truck slot, after run 014 is already completed'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'late_on_completed_run'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'available', true, 'price_per_kg', 10.0))
        from public.order_items where order_id = (select order_id from _scratch where label = 'late_on_completed_run')
      )
    )
  $$,
  'manager confirms the order, attaching it to the already-completed run 014 (confirm_order does not check run status)'
);

reset role;

select results_eq(
  $$ select run_id from public.orders where id = (select order_id from _scratch where label = 'late_on_completed_run') $$,
  $$ values ('b0000000-0000-0000-0000-000000000014'::uuid) $$,
  'confirming attaches the new order to the existing completed run (same truck+date)'
);

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000003';

select lives_ok(
  $$
    select public.complete_order_task(
      (select id from public.order_tasks where order_id = (select order_id from _scratch where label = 'late_on_completed_run')),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'weight_kg', 1.1, 'pieces', 1))
        from public.order_items where order_id = (select order_id from _scratch where label = 'late_on_completed_run')
      )
    )
  $$,
  'staff completes the task, moving the late order to ready on an already-completed run'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.set_run_status('b0000000-0000-0000-0000-000000000014'::uuid, 'completed'::public.delivery_run_status) $$,
  'manager re-fires completed -> completed on run 014 (idempotent, no longer invalid_transition)'
);

reset role;

select results_eq(
  $$ select status::text from public.orders where id = (select order_id from _scratch where label = 'late_on_completed_run') $$,
  $$ values ('delivered'::text) $$,
  'the completed -> completed re-fire delivers the late-ready order'
);

-- ---------------------------------------------------------------------------
-- 12. place_order: remaining untested error codes (zone_not_found,
-- slot_not_found, date_out_of_window, date_blocked), plus invalid_items via
-- a malformed (non-uuid) productId to prove the jsonb-cast guard.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '9 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'zone_not_found',
  'place_order rejects a zone that does not exist'
);

select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      current_date + 1,
      '10 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'slot_not_found',
  'place_order rejects a slot that does not exist'
);

select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 20,
      '11 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'date_out_of_window',
  'place_order rejects a date more than 14 days out'
);

select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '13 Test Street',
      null,
      '[{"productId":"not-a-uuid","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'invalid_items',
  'place_order turns a malformed (non-uuid) productId into invalid_items instead of a raw cast error'
);

-- Finding #5: 'NaN' is a textually-valid numeric literal in Postgres and
-- (per numeric's ordering rules) compares greater than every ordinary
-- value, so without the _order_safe_numeric guard it would sail past the
-- `v_quantity <= 0` check instead of failing invalid_items.
select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '19 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":"NaN","sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'invalid_items',
  'place_order rejects a NaN quantity literal instead of letting it poison the > 0 check'
);

reset role;

insert into public.schedule_blocks (organization_id, block_date, truck_id, created_by)
values ('b0000000-0000-0000-0000-00000000000a', current_date + 8, 'b0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select throws_ok(
  $$
    select public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 8,
      '12 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'P0001', 'date_blocked',
  'place_order rejects a date blocked for the slot''s truck'
);

reset role;

-- ---------------------------------------------------------------------------
-- 13. confirm_order: decisions_incomplete via a malformed (non-uuid)
-- item_id, proving the jsonb-cast guard instead of a raw cast error.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'confirm_bad_decisions', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '14 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'seed: place an order for the decisions_incomplete scenario'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'confirm_bad_decisions'),
      '[{"item_id":"not-a-uuid","available":false}]'::jsonb
    )
  $$,
  'P0001', 'decisions_incomplete',
  'confirm_order turns a malformed (non-uuid) item_id into decisions_incomplete instead of a raw cast error'
);

reset role;

-- ---------------------------------------------------------------------------
-- 14. complete_order_task: weights_incomplete (malformed item_id),
-- invalid_weight (non-positive weight_kg), then a valid completion followed
-- by task_done on the already-done task.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'complete_bad_weights', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '15 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'seed: place an order for the complete_order_task error-code scenarios'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'complete_bad_weights'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'available', true, 'price_per_kg', 10.0))
        from public.order_items where order_id = (select order_id from _scratch where label = 'complete_bad_weights')
      )
    )
  $$,
  'manager confirms the order so its allocate_weigh task is pending'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000003';

select throws_ok(
  $$
    select public.complete_order_task(
      (select id from public.order_tasks where order_id = (select order_id from _scratch where label = 'complete_bad_weights')),
      '[{"item_id":"not-a-uuid","weight_kg":3.0}]'::jsonb
    )
  $$,
  'P0001', 'weights_incomplete',
  'complete_order_task turns a malformed (non-uuid) item_id into weights_incomplete instead of a raw cast error'
);

select throws_ok(
  $$
    select public.complete_order_task(
      (select id from public.order_tasks where order_id = (select order_id from _scratch where label = 'complete_bad_weights')),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'weight_kg', -1, 'pieces', 1))
        from public.order_items where order_id = (select order_id from _scratch where label = 'complete_bad_weights')
      )
    )
  $$,
  'P0001', 'invalid_weight',
  'complete_order_task rejects a non-positive weight_kg'
);

select lives_ok(
  $$
    select public.complete_order_task(
      (select id from public.order_tasks where order_id = (select order_id from _scratch where label = 'complete_bad_weights')),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'weight_kg', 1.5, 'pieces', 1))
        from public.order_items where order_id = (select order_id from _scratch where label = 'complete_bad_weights')
      )
    )
  $$,
  'inventory-role staff completes the task with a valid payload'
);

select throws_ok(
  $$
    select public.complete_order_task(
      (select id from public.order_tasks where order_id = (select order_id from _scratch where label = 'complete_bad_weights')),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'weight_kg', 1.5, 'pieces', 1))
        from public.order_items where order_id = (select order_id from _scratch where label = 'complete_bad_weights')
      )
    )
  $$,
  'P0001', 'task_done',
  'complete_order_task rejects a task that is already done'
);

reset role;

-- ---------------------------------------------------------------------------
-- 15. close_order: lines_incomplete (malformed item_id) and invalid_price
-- (negative price_per_kg).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000004';

select lives_ok(
  $$
    insert into _scratch (label, order_id)
    select 'close_bad_lines', public.place_order(
      'b0000000-0000-0000-0000-00000000000a'::uuid,
      'b0000000-0000-0000-0000-000000000007'::uuid,
      'b0000000-0000-0000-0000-00000000000b'::uuid,
      current_date + 1,
      '16 Test Street',
      null,
      '[{"productId":"b0000000-0000-0000-0000-000000000006","mode":"kg","quantity":1.0,"sizeMinKg":1.0,"sizeMaxKg":2.0,"fallback":"mix"}]'::jsonb
    )
  $$,
  'seed: place an order for the close_order error-code scenarios'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'close_bad_lines'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'available', true, 'price_per_kg', 10.0))
        from public.order_items where order_id = (select order_id from _scratch where label = 'close_bad_lines')
      )
    )
  $$,
  'manager confirms the order'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000003';

select lives_ok(
  $$
    select public.complete_order_task(
      (select id from public.order_tasks where order_id = (select order_id from _scratch where label = 'close_bad_lines')),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'weight_kg', 1.2, 'pieces', 1))
        from public.order_items where order_id = (select order_id from _scratch where label = 'close_bad_lines')
      )
    )
  $$,
  'inventory-role staff completes the task, moving the order to ready'
);

reset role;

update public.orders set status = 'delivered' where id = (select order_id from _scratch where label = 'close_bad_lines');

set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select public.close_order(
      (select order_id from _scratch where label = 'close_bad_lines'),
      '[{"item_id":"not-a-uuid","final_weight_kg":1.0,"final_pieces":1,"price_per_kg":5.0}]'::jsonb
    )
  $$,
  'P0001', 'lines_incomplete',
  'close_order turns a malformed (non-uuid) item_id into lines_incomplete instead of a raw cast error'
);

select throws_ok(
  $$
    select public.close_order(
      (select order_id from _scratch where label = 'close_bad_lines'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'final_weight_kg', 1.0, 'final_pieces', 1, 'price_per_kg', -1))
        from public.order_items where order_id = (select order_id from _scratch where label = 'close_bad_lines')
      )
    )
  $$,
  'P0001', 'invalid_price',
  'close_order rejects a negative price_per_kg'
);

reset role;

select * from finish();
rollback;
