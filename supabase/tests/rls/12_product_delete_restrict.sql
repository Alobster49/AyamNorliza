-- supabase/tests/rls/12_product_delete_restrict.sql
-- Regression test for order-history durability, fixed by
-- 20260820000003_order_items_product_delete_restrict.sql.
--
-- An interim migration set order_items.product_id to "on delete cascade", which
-- meant deleting a product from the seller catalog page silently deleted its
-- historical order lines. This asserts the constraint is back to restrict: a
-- product that has been ordered cannot be deleted (23503), a product that has
-- never been ordered still can, and archiving (is_active = false) is always
-- available as the way out.

begin;

select plan(5);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('c0000000-0000-0000-0000-00000000000a', 'product-delete-test-org', 'Product Delete Test Org')
on conflict (id) do nothing;

insert into auth.users (id) values ('c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'owner', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.categories (id, organization_id, name, created_by)
values ('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a', 'Ayam', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- 003 has been ordered; 004 never has.
insert into public.products (id, organization_id, category_id, name, created_by)
values
  ('c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'Ordered Product', 'c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'Never Ordered Product', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-00000000000a', 'Test Customer', '0123456789', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values ('c0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-00000000000a', 'Zone', true, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('c0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-00000000000a', 'Truck A', 'TRK-PD', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('c0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000007', 1, '09:00', '12:00', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.orders (id, organization_id, customer_id, created_by, source, zone_id, delivery_address, delivery_date, slot_id, truck_id)
values ('c0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 'portal', 'c0000000-0000-0000-0000-000000000006', '1 Test Street', current_date + 1, 'c0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

insert into public.order_items (id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg, fallback)
values ('c0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000003', 'kg', 10, 1.4, 1.6, 'upsize')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The constraint itself
-- ---------------------------------------------------------------------------
select is(
  (select confdeltype from pg_constraint where conname = 'order_items_product_id_fkey'),
  'r'::"char",
  'order_items.product_id is ON DELETE RESTRICT, so order history survives catalog deletes'
);

-- ---------------------------------------------------------------------------
-- Deleting an ordered product is refused, and its order line stays put
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ delete from public.products where id = 'c0000000-0000-0000-0000-000000000003' $$,
  '23503',
  null,
  'deleting a product that has been ordered raises foreign_key_violation instead of destroying the order line'
);

select is(
  (select count(*)::int from public.order_items where id = 'c0000000-0000-0000-0000-00000000000b'),
  1,
  'the historical order line is still there after the refused delete'
);

-- ---------------------------------------------------------------------------
-- Archive is the way out, and a never-ordered product is still deletable
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.products set is_active = false where id = 'c0000000-0000-0000-0000-000000000003' $$,
  'an ordered product can always be archived (is_active = false), which is what the UI offers instead of delete'
);

select lives_ok(
  $$ delete from public.products where id = 'c0000000-0000-0000-0000-000000000004' $$,
  'a product that has never been ordered can still be hard-deleted'
);

select * from finish();

rollback;
