-- supabase/tests/rls/24_dashboard_rpcs.sql
-- Dashboard analytics RPCs: role gating and aggregate shape.

begin;

select plan(5);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('d1000000-0000-0000-0000-00000000000a', 'dash-rpc-test-org', 'Dash RPC Test Org')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('d1000000-0000-0000-0000-000000000001'), -- owner
  ('d1000000-0000-0000-0000-000000000002')  -- outsider (no membership)
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values ('d1000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'owner', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.categories (id, organization_id, name)
values ('d1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-00000000000a', 'Dash Cat')
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, is_active)
values ('d1000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-00000000000a',
        'd1000000-0000-0000-0000-000000000005', 'Dash Chicken', true)
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, created_by)
values ('d1000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-00000000000a', 'Dash Zone',
        'd1000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('d1000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-00000000000a', 'Dash Truck', 'DSH-A',
        'd1000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- NOTE: every "today" below uses the org timezone (the RPCs compare against
-- the KL-timezone day) — plain current_date is the server/UTC day and makes
-- these tests flaky between 00:00 and 08:00 MYT.
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, max_orders, created_by)
values ('d1000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-00000000000a',
        'd1000000-0000-0000-0000-000000000008',
        extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::smallint,
        '08:00', '12:00', 10, 'd1000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('d1000000-0000-0000-0000-00000000000c', 'd1000000-0000-0000-0000-00000000000a', 'Dash Customer', '0123456789',
        'd1000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- One delivered order (revenue 100.00) today, one pending order created now.
insert into public.orders (id, organization_id, customer_id, status, zone_id, delivery_address,
                           delivery_date, slot_id, truck_id, total_amount)
values
  ('d1000000-0000-0000-0000-000000000010', 'd1000000-0000-0000-0000-00000000000a',
   'd1000000-0000-0000-0000-00000000000c', 'delivered', 'd1000000-0000-0000-0000-000000000007',
   'Addr 1', (now() at time zone 'Asia/Kuala_Lumpur')::date, 'd1000000-0000-0000-0000-000000000009',
   'd1000000-0000-0000-0000-000000000008', 100.00),
  ('d1000000-0000-0000-0000-000000000011', 'd1000000-0000-0000-0000-00000000000a',
   'd1000000-0000-0000-0000-00000000000c', 'pending', 'd1000000-0000-0000-0000-000000000007',
   'Addr 2', (now() at time zone 'Asia/Kuala_Lumpur')::date, 'd1000000-0000-0000-0000-000000000009',
   'd1000000-0000-0000-0000-000000000008', 0)
on conflict (id) do nothing;

insert into public.order_items (id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
                                fallback, final_weight_kg, price_per_kg)
values ('d1000000-0000-0000-0000-000000000020', 'd1000000-0000-0000-0000-000000000010',
        'd1000000-0000-0000-0000-000000000006', 'kg', 5, 1.0, 2.0, 'mix', 5.000, 20.00)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- anon: no execute grant
-- ---------------------------------------------------------------------------
set local role anon;
set local "request.jwt.claim.sub" to '';
select throws_ok(
  $$ select public.get_dashboard_sales('d1000000-0000-0000-0000-00000000000a',
       (now() at time zone 'Asia/Kuala_Lumpur')::date - 6, (now() at time zone 'Asia/Kuala_Lumpur')::date) $$,
  '42501', null, 'anon cannot execute get_dashboard_sales');

-- ---------------------------------------------------------------------------
-- authenticated non-member: forbidden
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'd1000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select public.get_dashboard_sales('d1000000-0000-0000-0000-00000000000a',
       (now() at time zone 'Asia/Kuala_Lumpur')::date - 6, (now() at time zone 'Asia/Kuala_Lumpur')::date) $$,
  'P0001', 'forbidden', 'non-member gets forbidden');

-- ---------------------------------------------------------------------------
-- owner: payload shape and values
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'd1000000-0000-0000-0000-000000000001';

select ok(
  (select public.get_dashboard_sales('d1000000-0000-0000-0000-00000000000a',
     (now() at time zone 'Asia/Kuala_Lumpur')::date - 6, (now() at time zone 'Asia/Kuala_Lumpur')::date))
    ?& array['kpis','previous','series','funnel','topProducts','topCustomers','topZones'],
  'payload has all top-level keys');

select is(
  (select public.get_dashboard_sales('d1000000-0000-0000-0000-00000000000a',
     (now() at time zone 'Asia/Kuala_Lumpur')::date - 6, (now() at time zone 'Asia/Kuala_Lumpur')::date) -> 'kpis' ->> 'revenue')::numeric,
  100.00::numeric,
  'revenue counts the delivered order only');

select is(
  (select public.get_dashboard_sales('d1000000-0000-0000-0000-00000000000a',
     (now() at time zone 'Asia/Kuala_Lumpur')::date - 6, (now() at time zone 'Asia/Kuala_Lumpur')::date) -> 'funnel' ->> 'pending')::integer,
  1,
  'funnel counts the pending order created today');

select * from finish();
rollback;
