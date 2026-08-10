-- supabase/tests/rls/09_catalog_grants.sql
-- Table-GRANT regression test for the older catalog tables (categories,
-- products, product_variants, customers, buyers), fixed by
-- 20260811000001_catalog_table_grants.sql. Existing RLS tests only assert
-- `relrowsecurity = true`, which reads the same whether a denial comes from
-- RLS or from a missing base GRANT -- so this file specifically exercises
-- real row access through the anon/authenticated roles, the layer that was
-- silently broken (missing GRANTs return 42501 before RLS policies are even
-- evaluated).

begin;

select plan(4);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS/grants)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('b0000000-0000-0000-0000-00000000000a', 'catalog-grants-test-org', 'Catalog Grants Test Org')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('b0000000-0000-0000-0000-000000000001') -- owner
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000001', 'owner', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.categories (id, organization_id, name, is_active, created_by)
values ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Whole Chicken', true, 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.products (id, organization_id, category_id, name, is_active, created_by)
values ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000002', 'Standard Chicken', true, 'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- authenticated (an active org member) can really select and insert --
-- through the GRANT plus the RLS policy, not just relrowsecurity.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select id from public.products where organization_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('b0000000-0000-0000-0000-000000000003'::uuid) $$,
  'authenticated org member can select their org''s products'
);

select lives_ok(
  $$ insert into public.categories (id, organization_id, name, created_by) values ('b0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Frozen', 'b0000000-0000-0000-0000-000000000001') $$,
  'authenticated owner can insert a category (this is the exact createCategory path that returned "permission denied for table categories" before the grants migration)'
);

reset role;

-- ---------------------------------------------------------------------------
-- anon sees the active product via the public policy (categories_select_
-- public / products_select_public / product_variants_select_public in
-- 20260718120000_buyer_portal.sql), and cannot write -- the grant is
-- select-only.
-- ---------------------------------------------------------------------------
set local role anon;

select results_eq(
  $$ select id from public.products where organization_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('b0000000-0000-0000-0000-000000000003'::uuid) $$,
  'anon sees the active product via the public policy'
);

select throws_ok(
  $$ insert into public.products (id, organization_id, category_id, name, created_by) values ('b0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000002', 'Anon Product', 'b0000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'anon cannot insert a product (select-only grant)'
);

reset role;

select * from finish();
rollback;
