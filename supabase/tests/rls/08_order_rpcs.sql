-- supabase/tests/rls/08_order_rpcs.sql
-- Order lifecycle RPC behavior: place_order (happy path, slot_full,
-- weekday_mismatch), confirm_order (fallback applied, cancel-fallback
-- cancels the order), complete_order_task (ready + weight log),
-- close_order (total + manager-only), cancel_order (buyer while pending
-- only), reopen_order (org_admin only).

begin;

select plan(28);

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

select lives_ok(
  $$
    select public.confirm_order(
      (select order_id from _scratch where label = 'confirm'),
      (
        select jsonb_agg(jsonb_build_object('item_id', id, 'available', false))
        from public.order_items where order_id = (select order_id from _scratch where label = 'confirm')
      )
    )
  $$,
  'manager confirms the order, marking every line unavailable'
);

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
        select jsonb_agg(jsonb_build_object('item_id', id, 'final_weight_kg', 3.0, 'final_pieces', 2, 'price_per_kg', 12.50))
        from public.order_items
        where order_id = (select order_id from _scratch where label = 'confirm') and is_cancelled = false
      )
    )
  $$,
  'manager closes the order'
);

reset role;

select results_eq(
  $$ select status::text, total_amount from public.orders where id = (select order_id from _scratch where label = 'confirm') $$,
  $$ values ('closed'::text, 37.50::numeric) $$,
  'closing computes total_amount = final_weight_kg * price_per_kg'
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

select * from finish();
rollback;
