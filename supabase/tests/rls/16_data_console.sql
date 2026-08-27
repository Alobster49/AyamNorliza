-- supabase/tests/rls/16_data_console.sql
-- Coverage for 20260822000001_data_console_rpcs.sql: the owner-only wipe
-- and demo-seed RPCs behind the Data console page.
--
-- Pinned down: only an active owner may clear or seed, a clear removes the
-- business graph but never a user, and seeding twice lands in the same state.

begin;

select plan(12);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('dc000000-0000-0000-0000-00000000000a', 'data-console-test-org', 'Data Console Test Org')
on conflict (id) do nothing;

-- 001 owner, 002 seller, 003 org_admin, 004 buyer account.
insert into auth.users (id)
values
  ('dc000000-0000-0000-0000-000000000001'),
  ('dc000000-0000-0000-0000-000000000002'),
  ('dc000000-0000-0000-0000-000000000003'),
  ('dc000000-0000-0000-0000-000000000004')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000002', 'seller', 'active'),
  ('dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000003', 'org_admin', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.profiles (user_id, display_name)
values ('dc000000-0000-0000-0000-000000000001', 'Console Owner')
on conflict (user_id) do nothing;

-- A pre-existing customer + linked buyer so the clear/relink path is real.
insert into public.customers (id, organization_id, name, phone, created_by)
values ('dc000000-0000-0000-0000-000000000005', 'dc000000-0000-0000-0000-00000000000a', 'Old Customer', '0111111111', 'dc000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.buyers (id, organization_id, display_name, phone, customer_id)
values ('dc000000-0000-0000-0000-000000000004', 'dc000000-0000-0000-0000-00000000000a', 'Test Buyer', '0122222222', 'dc000000-0000-0000-0000-000000000005')
on conflict (id) do nothing;

-- Minimal business graph to prove the clear reaches it: category -> product
-- -> variant, zone, truck, slot, run, order -> item -> task -> weight log.
insert into public.categories (id, organization_id, name, created_by)
values ('dc000000-0000-0000-0000-000000000010', 'dc000000-0000-0000-0000-00000000000a', 'Cat', 'dc000000-0000-0000-0000-000000000001');
insert into public.products (id, organization_id, category_id, name, created_by)
values ('dc000000-0000-0000-0000-000000000011', 'dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000010', 'Prod', 'dc000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, organization_id, product_id, name, created_by)
values ('dc000000-0000-0000-0000-000000000012', 'dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000011', 'Per kg', 'dc000000-0000-0000-0000-000000000001');
insert into public.delivery_zones (id, organization_id, name, created_by)
values ('dc000000-0000-0000-0000-000000000013', 'dc000000-0000-0000-0000-00000000000a', 'Zone T', 'dc000000-0000-0000-0000-000000000001');
insert into public.trucks (id, organization_id, name, code, created_by)
values ('dc000000-0000-0000-0000-000000000014', 'dc000000-0000-0000-0000-00000000000a', 'Lori T', 'TRK-DC', 'dc000000-0000-0000-0000-000000000001');
insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('dc000000-0000-0000-0000-000000000015', 'dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000014', 1, '09:00', '12:00', 'dc000000-0000-0000-0000-000000000001');
insert into public.delivery_runs (id, organization_id, truck_id, run_date)
values ('dc000000-0000-0000-0000-000000000016', 'dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000014', current_date);
insert into public.orders (id, organization_id, customer_id, status, zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id, created_by)
values ('dc000000-0000-0000-0000-000000000017', 'dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000005', 'confirmed', 'dc000000-0000-0000-0000-000000000013', 'Addr', current_date, 'dc000000-0000-0000-0000-000000000015', 'dc000000-0000-0000-0000-000000000014', 'dc000000-0000-0000-0000-000000000016', 'dc000000-0000-0000-0000-000000000001');
insert into public.order_items (id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg, fallback)
values ('dc000000-0000-0000-0000-000000000018', 'dc000000-0000-0000-0000-000000000017', 'dc000000-0000-0000-0000-000000000011', 'kg', 2, 1.2, 1.6, 'mix');
insert into public.order_tasks (organization_id, order_id, type)
values ('dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000017', 'allocate_weigh');
insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by)
values ('dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000018', 'warehouse', 2.4, 'dc000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Helpers to impersonate users
-- ---------------------------------------------------------------------------
create or replace function pg_temp.impersonate(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- 1-2: non-owners are refused.
select pg_temp.impersonate('dc000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.admin_clear_org_data('dc000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'forbidden', 'seller cannot clear');
select throws_ok(
  $$ select public.admin_seed_demo_data('dc000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'forbidden', 'seller cannot seed');

-- 3: org_admin is also refused (owner only).
select pg_temp.impersonate('dc000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.admin_clear_org_data('dc000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'forbidden', 'org_admin cannot clear');

-- 4: owner clear succeeds.
select pg_temp.impersonate('dc000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.admin_clear_org_data('dc000000-0000-0000-0000-00000000000a') $$,
  'owner can clear');

-- 5-6: business graph is gone.
select set_config('role', 'postgres', true);
select is((select count(*) from public.orders where organization_id = 'dc000000-0000-0000-0000-00000000000a'), 0::bigint, 'orders wiped');
select is((select count(*) from public.products where organization_id = 'dc000000-0000-0000-0000-00000000000a'), 0::bigint, 'products wiped');

-- 7-9: users, memberships and buyers survive; buyer unlinked from customer.
select is((select count(*) from public.organization_members where organization_id = 'dc000000-0000-0000-0000-00000000000a'), 3::bigint, 'memberships kept');
select is((select count(*) from public.buyers where id = 'dc000000-0000-0000-0000-000000000004'), 1::bigint, 'buyer kept');
select ok((select customer_id is null from public.buyers where id = 'dc000000-0000-0000-0000-000000000004'), 'buyer unlinked from deleted customer');

-- 10-11: owner seed produces the demo dataset.
select pg_temp.impersonate('dc000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.admin_seed_demo_data('dc000000-0000-0000-0000-00000000000a') $$,
  'owner can seed');
select set_config('role', 'postgres', true);
select results_eq(
  $$ select
       (select count(*) from public.products where organization_id = 'dc000000-0000-0000-0000-00000000000a'),
       (select count(*) from public.customers where organization_id = 'dc000000-0000-0000-0000-00000000000a'),
       (select count(*) from public.orders where organization_id = 'dc000000-0000-0000-0000-00000000000a'),
       (select count(*) from public.delivery_runs where organization_id = 'dc000000-0000-0000-0000-00000000000a')
  $$,
  $$ values (13::bigint, 11::bigint, 67::bigint, 24::bigint) $$,
  'seed row counts (10 demo customers + 1 relinked buyer customer; 18 live + 49 history orders, 3 live + 21 history runs)');

-- 12: seeding twice is idempotent.
select pg_temp.impersonate('dc000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.admin_seed_demo_data('dc000000-0000-0000-0000-00000000000a') $$,
  'seed is idempotent');

select * from finish();
rollback;
