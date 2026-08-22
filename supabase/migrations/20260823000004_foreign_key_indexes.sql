-- 20260823000004_foreign_key_indexes.sql
-- Cover the foreign keys that are actually on a hot path with an index.
--
-- Postgres indexes the *referenced* side of a foreign key automatically (it
-- has to be unique) but never the *referencing* side, so an unindexed FK
-- column means every delete on the parent, and every query that filters on
-- that column, is a sequential scan of the child table.
--
-- The schema had 36 uncovered FKs. Most are created_by / recorded_by audit
-- columns that nothing filters on and whose parent (auth.users) is
-- effectively never deleted -- those are left alone deliberately. The ones
-- below are the columns the app filters on every page load, or the ones a
-- routine delete has to scan.
--
-- Plain CREATE INDEX, not CONCURRENTLY: these tables are small enough that
-- the brief write lock is not worth the risk of leaving an invalid index
-- behind on failure. Revisit if orders ever gets large.

begin;

-- Dispatch board: "orders on this truck" and "orders in this zone" are the
-- two filters the board is built from, and trucks/zones are ON DELETE
-- RESTRICT so deactivating either scans orders today.
create index if not exists orders_truck_idx on public.orders (truck_id);
create index if not exists orders_zone_idx  on public.orders (zone_id);

-- order_items.product_id is ON DELETE RESTRICT (20260820000003), so deleting
-- a product scans every order line in the database to prove it is unused.
create index if not exists order_items_product_idx on public.order_items (product_id);

-- Org-scoped reads on the delivery history tables. These three carry an
-- organization_id that RLS and every report filters on, with no index.
create index if not exists delivery_attempts_org_idx on public.delivery_attempts (organization_id);
create index if not exists order_weight_log_org_idx  on public.order_weight_log (organization_id);
create index if not exists run_stop_events_org_idx   on public.run_stop_events (organization_id);

-- admin_clear_org_data nulls buyers.customer_id for the whole org before it
-- deletes customers, and the FK itself is ON DELETE SET NULL.
create index if not exists buyers_customer_idx on public.buyers (customer_id);

-- Blocked dates are always looked up per truck.
create index if not exists schedule_blocks_truck_idx on public.schedule_blocks (truck_id);

-- buyers_user_idx is btree (id) -- the exact same column set as
-- buyers_pkey, which is already a unique btree on (id). It has never been
-- able to serve a query the primary key could not, and it costs a write on
-- every buyer insert and update.
drop index if exists public.buyers_user_idx;

commit;
