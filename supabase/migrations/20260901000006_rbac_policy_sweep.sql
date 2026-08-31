-- Task 13, part 1: move the resource table policies onto `has_permission()`.
--
-- 20260901000002 rewrote 27 RPCs onto the dynamic-RBAC resolver but left every
-- table policy testing `organization_members.role` against a hardcoded list.
-- The Roles & Permissions page has been lying in both directions ever since:
-- a grant it shows as given is refused by RLS, and one it shows as revoked
-- still works, because the policy only ever looked at the legacy role name.
--
-- This migration covers the write policies whose resource maps one-to-one
-- onto an RBAC resource, plus the two reads that named roles outright. Each
-- table is mapped to the resource the Server Actions already guard it with,
-- so the two layers agree:
--
--   categories / products / product_variants   -> products
--   customers (+ buyers read)                  -> customers
--   market_settings                            -> market_prices
--   delivery_zones / delivery_slots / trucks /
--     truck_zones / schedule_blocks / bays /
--     zone_postcode_ranges                     -> delivery_runs
--   facilities                                 -> delivery_setup
--
-- Two side effects worth naming:
--
--   * `has_permission` filters `expires_at is null or expires_at > now()`,
--     which the catalog, customer and market policies never did. A member
--     whose temporary access has lapsed loses these writes, matching every
--     other policy in the schema and the app-layer fix in the same batch.
--   * UPDATE policies gain a WITH CHECK identical to their USING clause.
--     They had none, so a permitted update could rewrite `organization_id`
--     and move a row into another org.
--
-- SELECT policies that already read "any active member" are deliberately
-- left alone: they name no role, and narrowing reads is a product decision
-- about which pages keep working, not a lie the roles editor is telling.
--
-- NOT covered here, and still hardcoded (see docs/backend-audit-2026-08-31.md):
-- the `role <> 'driver'` operational reads on orders / order_items /
-- delivery_runs / delivery_attempts / run_stop_events, and the admin tables
-- (audit_log, auth_security_events, break_glass_events, support_sessions,
-- profiles). Both groups change who can read core data and need the app
-- exercised before they move. `organizations_insert_owner` stays role-based
-- by necessity: the caller has no membership yet when creating an org.

begin;

-- ---------------------------------------------------------------------------
-- Catalog -> products
-- ---------------------------------------------------------------------------
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (public.has_permission(organization_id, 'products', 'add'));
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using (public.has_permission(organization_id, 'products', 'edit'))
  with check (public.has_permission(organization_id, 'products', 'edit'));
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated
  using (public.has_permission(organization_id, 'products', 'delete'));

drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert to authenticated
  with check (public.has_permission(organization_id, 'products', 'add'));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
  using (public.has_permission(organization_id, 'products', 'edit'))
  with check (public.has_permission(organization_id, 'products', 'edit'));
drop policy if exists products_delete on public.products;
create policy products_delete on public.products for delete to authenticated
  using (public.has_permission(organization_id, 'products', 'delete'));

drop policy if exists product_variants_insert on public.product_variants;
create policy product_variants_insert on public.product_variants for insert to authenticated
  with check (public.has_permission(organization_id, 'products', 'add'));
drop policy if exists product_variants_update on public.product_variants;
create policy product_variants_update on public.product_variants for update to authenticated
  using (public.has_permission(organization_id, 'products', 'edit'))
  with check (public.has_permission(organization_id, 'products', 'edit'));
drop policy if exists product_variants_delete on public.product_variants;
create policy product_variants_delete on public.product_variants for delete to authenticated
  using (public.has_permission(organization_id, 'products', 'delete'));

-- ---------------------------------------------------------------------------
-- Customers -> customers. The read named roles outright, so it moves too.
-- ---------------------------------------------------------------------------
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (public.has_permission(organization_id, 'customers', 'view'));
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_permission(organization_id, 'customers', 'add'));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (public.has_permission(organization_id, 'customers', 'edit'))
  with check (public.has_permission(organization_id, 'customers', 'edit'));
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete to authenticated
  using (public.has_permission(organization_id, 'customers', 'delete'));

-- A buyer row is the portal login attached to a customer, so staff-side
-- visibility follows the customer grant.
drop policy if exists buyers_select_seller on public.buyers;
create policy buyers_select_seller on public.buyers for select to authenticated
  using (public.has_permission(organization_id, 'customers', 'view'));

-- ---------------------------------------------------------------------------
-- Market settings -> market_prices
-- ---------------------------------------------------------------------------
drop policy if exists market_settings_insert on public.market_settings;
create policy market_settings_insert on public.market_settings for insert to authenticated
  with check (public.has_permission(org_id, 'market_prices', 'add'));
drop policy if exists market_settings_update on public.market_settings;
create policy market_settings_update on public.market_settings for update to authenticated
  using (public.has_permission(org_id, 'market_prices', 'edit'))
  with check (public.has_permission(org_id, 'market_prices', 'edit'));

-- ---------------------------------------------------------------------------
-- Delivery setup -> delivery_runs (the resource the schedule and facility
-- Server Actions already gate these writes on), except the facility row
-- itself, which they gate on delivery_setup:edit.
-- ---------------------------------------------------------------------------
drop policy if exists delivery_zones_insert on public.delivery_zones;
create policy delivery_zones_insert on public.delivery_zones for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_runs', 'add'));
drop policy if exists delivery_zones_update on public.delivery_zones;
create policy delivery_zones_update on public.delivery_zones for update to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'edit'))
  with check (public.has_permission(organization_id, 'delivery_runs', 'edit'));
drop policy if exists delivery_zones_delete on public.delivery_zones;
create policy delivery_zones_delete on public.delivery_zones for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'delete'));

drop policy if exists delivery_slots_insert on public.delivery_slots;
create policy delivery_slots_insert on public.delivery_slots for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_runs', 'add'));
drop policy if exists delivery_slots_update on public.delivery_slots;
create policy delivery_slots_update on public.delivery_slots for update to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'edit'))
  with check (public.has_permission(organization_id, 'delivery_runs', 'edit'));
drop policy if exists delivery_slots_delete on public.delivery_slots;
create policy delivery_slots_delete on public.delivery_slots for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'delete'));

drop policy if exists trucks_insert on public.trucks;
create policy trucks_insert on public.trucks for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_runs', 'add'));
drop policy if exists trucks_update on public.trucks;
create policy trucks_update on public.trucks for update to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'edit'))
  with check (public.has_permission(organization_id, 'delivery_runs', 'edit'));
drop policy if exists trucks_delete on public.trucks;
create policy trucks_delete on public.trucks for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'delete'));

drop policy if exists truck_zones_insert on public.truck_zones;
create policy truck_zones_insert on public.truck_zones for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_runs', 'add'));
drop policy if exists truck_zones_delete on public.truck_zones;
create policy truck_zones_delete on public.truck_zones for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'delete'));

drop policy if exists schedule_blocks_insert on public.schedule_blocks;
create policy schedule_blocks_insert on public.schedule_blocks for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_runs', 'add'));
drop policy if exists schedule_blocks_delete on public.schedule_blocks;
create policy schedule_blocks_delete on public.schedule_blocks for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'delete'));

drop policy if exists bays_insert on public.bays;
create policy bays_insert on public.bays for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_runs', 'add'));
drop policy if exists bays_update on public.bays;
create policy bays_update on public.bays for update to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'edit'))
  with check (public.has_permission(organization_id, 'delivery_runs', 'edit'));
drop policy if exists bays_delete on public.bays;
create policy bays_delete on public.bays for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'delete'));

drop policy if exists zone_postcode_ranges_insert on public.zone_postcode_ranges;
create policy zone_postcode_ranges_insert on public.zone_postcode_ranges for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_runs', 'add'));
drop policy if exists zone_postcode_ranges_delete on public.zone_postcode_ranges;
create policy zone_postcode_ranges_delete on public.zone_postcode_ranges for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_runs', 'delete'));

drop policy if exists facilities_insert on public.facilities;
create policy facilities_insert on public.facilities for insert to authenticated
  with check (public.has_permission(organization_id, 'delivery_setup', 'edit'));
drop policy if exists facilities_update on public.facilities;
create policy facilities_update on public.facilities for update to authenticated
  using (public.has_permission(organization_id, 'delivery_setup', 'edit'))
  with check (public.has_permission(organization_id, 'delivery_setup', 'edit'));
drop policy if exists facilities_delete on public.facilities;
create policy facilities_delete on public.facilities for delete to authenticated
  using (public.has_permission(organization_id, 'delivery_setup', 'edit'));

-- ---------------------------------------------------------------------------
-- Storage buckets.
--
-- Object paths start with the org id, so each policy resolves the caller's
-- own orgs and asks `has_permission` per org rather than casting a
-- caller-supplied path segment to uuid.
-- ---------------------------------------------------------------------------
drop policy if exists product_images_seller_insert on storage.objects;
create policy product_images_seller_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select m.organization_id::text from public.organization_members m
       where m.user_id = (select auth.uid())
         and public.has_permission(m.organization_id, 'products', 'add'))
  );

drop policy if exists product_images_seller_update on storage.objects;
create policy product_images_seller_update on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select m.organization_id::text from public.organization_members m
       where m.user_id = (select auth.uid())
         and public.has_permission(m.organization_id, 'products', 'edit'))
  );

drop policy if exists product_images_seller_delete on storage.objects;
create policy product_images_seller_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select m.organization_id::text from public.organization_members m
       where m.user_id = (select auth.uid())
         and public.has_permission(m.organization_id, 'products', 'delete'))
  );

-- Proof-of-delivery: the assigned driver writes into their own run folder;
-- staff-side uploads followed a role list that still named the retired
-- `logistics` key, so a Worker (`inventory`, the role that replaced it) has
-- been unable to upload since the role realignment. Keyed on the grants the
-- delivery and loading screens actually use.
drop policy if exists delivery_pod_write on storage.objects;
create policy delivery_pod_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-pod'
    and (
      (storage.foldername(name))[2] in (select (public.driver_run_ids())::text)
      or (storage.foldername(name))[1] in (
        select m.organization_id::text from public.organization_members m
         where m.user_id = (select auth.uid())
           and (public.has_permission(m.organization_id, 'delivery_runs', 'edit')
                or public.has_permission(m.organization_id, 'loading', 'edit')))
    )
  );

drop policy if exists leave_att_approver_read on storage.objects;
create policy leave_att_approver_read on storage.objects for select to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] in (
      select m.organization_id::text from public.organization_members m
       where m.user_id = (select auth.uid())
         and public.has_permission(m.organization_id, 'leave_management', 'view'))
  );

commit;
