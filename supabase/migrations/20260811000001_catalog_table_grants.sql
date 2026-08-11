-- 20260811000001_catalog_table_grants.sql
-- Forward-only privilege repair, following the id_access precedent
-- (20260625000005_id_access_and_structure_grants.sql) and Task 1's grant
-- style (20260810000001_order_pipeline_schema.sql): `categories`,
-- `products`, `product_variants`, `customers`, and `buyers` were created
-- with RLS policies but no explicit table GRANTs to `anon`/`authenticated`.
--
-- The contract for the older catalog/buyer-portal migrations
-- (20260718000001_seller_role_and_catalog.sql, 20260718120000_buyer_portal.
-- sql) said "No explicit table GRANTs (Supabase default grants apply)".
-- That's false in this project: Supabase's local/hosted Postgres does not
-- grant anon/authenticated anything on a table by default, so every query
-- against these tables failed with `permission denied for table X` (42501)
-- at the GRANT layer, before RLS is even evaluated -- regardless of how
-- permissive the RLS policy is. This went unnoticed because no pgTAP test
-- or e2e test exercised real row access on these five tables (existing
-- tests only asserted `relrowsecurity = true`). Task 1's order-pipeline
-- schema migration hit the same wall for its own new tables and fixed it
-- with explicit grants there; this migration does the same for the older
-- catalog/buyer tables it flagged as a follow-up. RLS policies still
-- determine row/action access -- these grants only clear the layer in
-- front of them.
--
-- `categories`, `products`, and `product_variants` also get `select` for
-- `anon`, because each has a public policy scoped to active/available rows
-- (`categories_select_public`, `products_select_public`,
-- `product_variants_select_public`, all in 20260718120000_buyer_portal.sql)
-- meant to let an unauthenticated buyer-portal visitor browse the catalog.
-- `customers` and `buyers` have no such public policy, so they get no anon
-- grant. `buyers` gets `select, insert, update` (no `delete`) to
-- `authenticated` -- buyer accounts are created/updated via
-- buyer-auth server actions but are never hard-deleted by the app.
--
-- Grants alone are not enough for those three tables' anon path, though:
-- their org-membership policies (`categories_select`, `products_select`,
-- `product_variants_select`) were left unscoped (no `to` clause, so they
-- apply to every role including anon) and each subqueries
-- `organization_members`, which anon has no grant on. Postgres evaluates
-- every applicable permissive policy regardless of whether the role could
-- ever satisfy it, so an anon `select` against e.g. `products` still trips
-- `permission denied for table organization_members` even after `products`
-- itself is granted to anon -- the exact failure mode Task 1's migration
-- already diagnosed and fixed for `delivery_zones` (see its "Grants are
-- explicit" note). This migration applies the same fix here: scope the
-- org-membership policies `to authenticated` and the public policies `to
-- anon, authenticated`, matching Task 1's `delivery_zones_select` /
-- `delivery_zones_select_public` pattern exactly.

begin;

grant select, insert, update, delete on
  public.categories,
  public.products,
  public.product_variants,
  public.customers
to authenticated;

grant select, insert, update on public.buyers to authenticated;

grant select on
  public.categories,
  public.products,
  public.product_variants
to anon;

alter policy "categories_select" on public.categories to authenticated;
alter policy "categories_insert" on public.categories to authenticated;
alter policy "categories_update" on public.categories to authenticated;
alter policy "categories_select_public" on public.categories to anon, authenticated;

alter policy "products_select" on public.products to authenticated;
alter policy "products_insert" on public.products to authenticated;
alter policy "products_update" on public.products to authenticated;
alter policy "products_select_public" on public.products to anon, authenticated;

alter policy "product_variants_select" on public.product_variants to authenticated;
alter policy "product_variants_insert" on public.product_variants to authenticated;
alter policy "product_variants_update" on public.product_variants to authenticated;
alter policy "product_variants_select_public" on public.product_variants to anon, authenticated;

commit;
