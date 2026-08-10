# Order Module Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two disconnected order systems with one unified pipeline — customer orders with size ranges and pre-declared fallbacks, zone/truck delivery scheduling, staff weighing tasks, delivery runs with printable manifests, and manager settlement at final weight × per-order price per kg.

**Architecture:** Postgres-first: all order state transitions run through security-definer RPCs (atomic capacity checks, weight logging, settlement math), with RLS granting members read and buyers read-own; a new `src/features/orders/` feature owns types, pure domain logic, and role-guarded server actions consumed by both the buyer portal and the seller app. Spec: `docs/superpowers/specs/2026-08-10-order-module-design.md`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS + RPC, pgTAP), TypeScript, Zod, shadcn/ui + Tailwind, Vitest, Playwright.

## Global Constraints

- All commands run from `/Users/alob/AyamNorliza-1`. Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:test`, `npm run test:e2e`; DB rebuild `npm run db:reset`; regenerate types `npm run db:types`.
- Vitest only collects `src/features/**/tests/unit/**/*.test.ts` and `src/lib/**/*.test.ts` — place unit tests accordingly.
- Old order tables (`orders`, `order_items`, `buyer_orders`, `buyer_order_items`) hold dev data only — dropped without migration of rows.
- New enum values are exactly: order_status `pending|confirmed|ready|delivered|closed|cancelled`; mode `piece|kg`; fallback `cancel|mix|upsize|downsize`; run status `planned|departed|completed`; weight log kind `warehouse|final`.
- Roles: manager = `owner|org_admin|seller`; staff adds `inventory|logistics`. Role arrays (`MANAGER_ROLES`/`STAFF_ROLES` from `src/features/orders/lib/roles.ts`), not the capability system — SQL RPCs enforce with the existing `has_org_role(uuid, text[])`; the capability system's DB mirror is hand-synced and already missing `seller`, so extending it buys no enforcement.
- Every new server action self-guards (requireOrgRole / requireBuyer) — never rely on layout-level checks alone (the existing seller actions' missing per-call guards are a known defect; do not copy).
- Booking window: tomorrow through +14 days. Slot weekday convention 0=Sunday (JS `Date.getDay()`).
- Settlement: every order (piece and kg mode) closes as Σ round(final_weight_kg × price_per_kg, 2) over non-cancelled lines. Price is keyed per order at close; there is no stored price list.
- Currency formatting: `Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" })` via the shared `formatPrice` in `src/features/orders/lib/order-model.ts`.
- Buyer portal pages live under `/buyer_portal/[organizationSlug]/...`; seller pages under `/[organizationSlug]/...` (route group `(seller)`).
- Commit prefixes: `feat(orders):` pipeline/DB, `feat(portal):` buyer UI, `feat(seller):` seller UI, `test(e2e):`, `chore(orders):` cleanup.

## File Structure

New feature `src/features/orders/`: `types.ts` (enums, row types, Zod schemas, ActionResult), `lib/roles.ts` (role arrays), `lib/order-model.ts` (transitions, money/weight math, warnings, formatters), `server/guards.ts` (requireOrgRole, requireRoleOrRedirect), `server/schedule-actions.ts` (zone/truck/slot/block CRUD), `server/portal-actions.ts` (buyer-facing), `server/order-actions.ts` (manager/staff), `tests/unit/*` (five test files).

Database: `supabase/migrations/20260810000001_order_pipeline_schema.sql` (10 tables, 6 enums, RLS, grants), `...000002_order_pipeline_functions.sql` (8 RPCs), `...000003_order_pipeline_seed.sql` (pilot zones/trucks/slots + e2e buyer); pgTAP `supabase/tests/rls/07_order_pipeline.sql`, `08_order_rpcs.sql`.

Buyer portal: rewrite `cart-context.tsx`, `product-card.tsx`, `product-grid.tsx`, `cart/page.tsx`, `checkout/page.tsx`, `orders/page.tsx`, `orders/[orderId]/page.tsx`; delete `src/app/api/buyer/cart/route.ts`.

Seller app: new `delivery/`, `runs/` (+ `runs/[runId]/manifest/`), `tasks/` routes; rewrite `orders/`, `orders/[orderId]/`, `orders/new/`; modify `layout.tsx`, `dashboard-shell-model.ts`, `app-sidebar.tsx`.

E2E: `e2e/order-pipeline.spec.ts`, `e2e/buyer-order.spec.ts`, extended `e2e/_fixtures.ts`. Final cleanup task removes superseded order code from buyer/seller features.

## Cross-task reconciliation notes (read before executing)

1. **Grants are explicit (deviation from the original contract, verified live):** unscoped policies + no table grants leave anon/authenticated blocked at the GRANT layer (42501) before RLS runs — the same latent bug already present on `products`/`customers`/`buyers`. Task 1's migration therefore issues explicit `grant ... to authenticated` (+ `grant select ... to anon` where public) and scopes every policy with `to authenticated` / `to anon, authenticated`. A follow-up migration for the older catalog tables is out of scope here.
2. **Redirect gating:** Task 6 exports `requireRoleOrRedirect(slug, roles)` (redirects to `/${slug}`). Tasks 11–13 intentionally use inline `try { requireOrgRole } catch (OrderPermissionError) { redirect(...) }` where the destination differs (e.g. staff hitting `delivery/` bounce to `/tasks`). Both patterns are correct; do not "unify" them into the wrong destination.
3. **Staff task window:** `getTodayTasks` filters `order.delivery_date <= tomorrow` (not `<= today`) — orders are always booked for tomorrow at the earliest, and staff weigh the day before delivery.
4. **Row types are hand-written** in `orders/types.ts` (matching the buyer feature's style) so Task 4 doesn't depend on migrations/codegen. After Task 1 regenerates `src/types/database.generated.ts`, diff the shapes once; numeric columns arrive as JS numbers via PostgREST.
5. **E2E selectors** in Task 14 assume the accessible names Tasks 9–13 introduce (labels like "Min size (kg)", buttons like "Confirm", "Mark departed"). If an executor deviates from those names in UI tasks, reconcile the specs in Task 14 rather than the UI.
6. **RPC error codes:** SQL raises machine codes (`slot_full`, `date_blocked`, …); the single TS translator is `mapRpcError` in `server/order-actions.ts`. Manual-order path reuses `forbidden` for "customer not in org"; invalid ids surface as `invalid_status`/`invalid_transition` — there is deliberately no separate not-found code.

---
### Task 1: Order pipeline schema migration

**Files:**
Create: `supabase/migrations/20260810000001_order_pipeline_schema.sql`
Create: `supabase/tests/rls/07_order_pipeline.sql`
Modify: `src/types/database.generated.ts` (regenerated by `npm run db:types`, not hand-edited)

**Interfaces:**
Consumes: `public.has_org_role(target_org uuid, roles text[]) returns boolean` (existing, `supabase/migrations/20260624000002_id_access_rls.sql`), `public.set_updated_at()` trigger function (existing), `public.organizations`, `public.customers`, `public.products`, `public.buyers` tables (existing).
Produces (consumed by Task 2's RPCs, Task 3's seed, and every later TS task): enums `public.order_status | order_item_mode | order_fallback | order_task_status | delivery_run_status | weight_log_kind`; tables `public.delivery_zones | trucks | truck_zones | delivery_slots | schedule_blocks | delivery_runs | orders | order_items | order_tasks | order_weight_log`; column `public.buyers.customer_id uuid null`.

- [ ] **Write the failing pgTAP test.** Create `supabase/tests/rls/07_order_pipeline.sql`:

```sql
-- supabase/tests/rls/07_order_pipeline.sql
-- Order pipeline schema RLS: anon gets the public zone list but not trucks;
-- buyers see only their own orders; any active org member (including
-- warehouse-only roles) can read orders but only managers can write
-- schedule tables; orders/order_items have no direct-write policies at all
-- (writes are RPC-only, added in migration 2).

begin;

select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('a0000000-0000-0000-0000-00000000000a', 'order-pipeline-test-org', 'Order Pipeline Test Org')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'), -- manager (owner)
  ('a0000000-0000-0000-0000-000000000002'), -- inventory staff
  ('a0000000-0000-0000-0000-000000000003')  -- buyer (not an org member)
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'inventory', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Test Customer', '0123456789', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active, created_by)
values
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', 'Active Zone', true, 'a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'Inactive Zone', false, 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.trucks (id, organization_id, name, code, created_by)
values ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', 'Truck A', 'TRK-A', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, created_by)
values ('a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000007', 1, '09:00', '12:00', 'a0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- order_own: created_by the buyer
insert into public.orders (id, organization_id, customer_id, created_by, source, zone_id, delivery_address, delivery_date, slot_id, truck_id)
values ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'portal', 'a0000000-0000-0000-0000-000000000005', '1 Test Street', current_date + 1, 'a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

-- order_other: created_by the manager (not the buyer)
insert into public.orders (id, organization_id, customer_id, created_by, source, zone_id, delivery_address, delivery_date, slot_id, truck_id)
values ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'manual', 'a0000000-0000-0000-0000-000000000005', '2 Test Street', current_date + 1, 'a0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS enabled on every new table
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where relname = 'delivery_zones' and relnamespace = 'public'::regnamespace), 'delivery_zones RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'trucks' and relnamespace = 'public'::regnamespace), 'trucks RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'truck_zones' and relnamespace = 'public'::regnamespace), 'truck_zones RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'delivery_slots' and relnamespace = 'public'::regnamespace), 'delivery_slots RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'schedule_blocks' and relnamespace = 'public'::regnamespace), 'schedule_blocks RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'delivery_runs' and relnamespace = 'public'::regnamespace), 'delivery_runs RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'orders' and relnamespace = 'public'::regnamespace), 'orders RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'order_items' and relnamespace = 'public'::regnamespace), 'order_items RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'order_tasks' and relnamespace = 'public'::regnamespace), 'order_tasks RLS is on');
select ok((select relrowsecurity from pg_class where relname = 'order_weight_log' and relnamespace = 'public'::regnamespace), 'order_weight_log RLS is on');

-- ---------------------------------------------------------------------------
-- anon: sees the active zone via the public policy, not the inactive one,
-- and cannot read trucks at all (no anon grant, no public policy).
-- ---------------------------------------------------------------------------
set local role anon;

-- Scoped to this test's fixture org: the public policy is intentionally
-- global (no org filter, matching the contract), so an unscoped query would
-- also pick up any other org's active zones (e.g. the pilot seed data from
-- Task 3, which lands in the same database once that migration exists).
select results_eq(
  $$ select id from public.delivery_zones where organization_id = 'a0000000-0000-0000-0000-00000000000a' order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000005'::uuid) $$,
  'anon sees only the active delivery zone in this org'
);

select throws_ok(
  $$ select count(*) from public.trucks $$,
  '42501',
  null,
  'anon cannot read trucks'
);

reset role;

-- ---------------------------------------------------------------------------
-- buyer: sees only their own order via orders_select_buyer.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000003';

select results_eq(
  $$ select id from public.orders order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000009'::uuid) $$,
  'buyer sees only their own order, not others in the org'
);

reset role;

-- ---------------------------------------------------------------------------
-- inventory-role member: reads all org orders (any active member can), but
-- cannot update them directly -- orders has no write policy, RPC-only.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000002';

select results_eq(
  $$ select id from public.orders order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000009'::uuid), ('a0000000-0000-0000-0000-00000000000b'::uuid) $$,
  'inventory-role member reads every order in the org'
);

select throws_ok(
  $$ update public.orders set notes = 'tampered' where id = 'a0000000-0000-0000-0000-000000000009' $$,
  '42501',
  null,
  'inventory-role member cannot update orders directly (no write policy)'
);

reset role;

-- ---------------------------------------------------------------------------
-- manager can insert a delivery_zone; inventory role cannot.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ insert into public.delivery_zones (id, organization_id, name, created_by) values ('a0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000a', 'Manager Zone', 'a0000000-0000-0000-0000-000000000001') $$,
  'manager (owner) can insert a delivery_zone'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ insert into public.delivery_zones (id, organization_id, name, created_by) values ('a0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000a', 'Inventory Zone', 'a0000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'inventory-role member cannot insert a delivery_zone'
);

reset role;

select * from finish();
rollback;
```

- [ ] **Run it and confirm it fails** (the tables don't exist yet):

```
npm run db:test
```

Expected output (truncated to the relevant lines):

```
/Users/alob/AyamNorliza-1/supabase/tests/rls/06_audit_log.sql ............. ok
psql:/Users/alob/AyamNorliza-1/supabase/tests/rls/07_order_pipeline.sql:39: ERROR:  relation "public.delivery_zones" does not exist
LINE 1: insert into public.delivery_zones (id, organization_id, name...
                    ^
/Users/alob/AyamNorliza-1/supabase/tests/rls/07_order_pipeline.sql ........
Dubious, test returned 3 (wstat 768, 0x300)
Failed 17/17 subtests

Test Summary Report
-------------------
/Users/alob/AyamNorliza-1/supabase/tests/rls/07_order_pipeline.sql      (Wstat: 768 (exited 3) Tests: 0 Failed: 0)
  Non-zero exit status: 3
  Parse errors: Bad plan.  You planned 17 tests but ran 0.
Files=9, Tests=17,  0 wallclock secs (...)
Result: FAIL
```

- [ ] **Write the migration.** Create `supabase/migrations/20260810000001_order_pipeline_schema.sql`:

```sql
-- 20260810000001_order_pipeline_schema.sql
-- Order pipeline: scheduling (zones/trucks/slots/blocks), unified orders
-- (portal + manual), and ops extras (tasks/runs/weight log). Replaces the
-- old orders/order_items (seller) and buyer_orders/buyer_order_items
-- (portal) tables and order_status enum -- dev data only, dropped freely.

begin;

-- ---------------------------------------------------------------------------
-- Drop old order shapes
-- ---------------------------------------------------------------------------
drop table if exists public.buyer_order_items;
drop table if exists public.buyer_orders;
drop table if exists public.order_items;
drop table if exists public.orders;
drop type if exists public.order_status;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.order_status as enum ('pending','confirmed','ready','delivered','closed','cancelled');
create type public.order_item_mode as enum ('piece','kg');
create type public.order_fallback as enum ('cancel','mix','upsize','downsize');
create type public.order_task_status as enum ('pending','done');
create type public.delivery_run_status as enum ('planned','departed','completed');
create type public.weight_log_kind as enum ('warehouse','final');

-- ---------------------------------------------------------------------------
-- delivery_zones
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists delivery_zones_org_idx on public.delivery_zones(organization_id);
create index if not exists delivery_zones_org_active_idx on public.delivery_zones(organization_id, is_active) where is_active = true;

comment on table public.delivery_zones is 'Fixed delivery location zones customers pick at checkout.';

drop trigger if exists delivery_zones_updated_at on public.delivery_zones;
create trigger delivery_zones_updated_at before update on public.delivery_zones
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- trucks
-- ---------------------------------------------------------------------------
create table if not exists public.trucks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  code text not null check (char_length(code) between 1 and 20),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(organization_id, code)
);

create index if not exists trucks_org_idx on public.trucks(organization_id);

comment on table public.trucks is 'Delivery trucks; each truck is one loading bay ("lot bay").';

drop trigger if exists trucks_updated_at on public.trucks;
create trigger trucks_updated_at before update on public.trucks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- truck_zones
-- ---------------------------------------------------------------------------
create table if not exists public.truck_zones (
  truck_id uuid not null references public.trucks(id) on delete cascade,
  zone_id uuid not null references public.delivery_zones(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (truck_id, zone_id)
);

create index if not exists truck_zones_zone_idx on public.truck_zones(zone_id);

comment on table public.truck_zones is 'Coverage join: which trucks deliver to which zones.';

-- ---------------------------------------------------------------------------
-- delivery_slots
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  max_orders integer null check (max_orders > 0),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (end_time > start_time)
);

create index if not exists delivery_slots_truck_idx on public.delivery_slots(truck_id);
create index if not exists delivery_slots_org_idx on public.delivery_slots(organization_id);

comment on table public.delivery_slots is 'Weekly recurring delivery time windows per truck (weekday 0=Sunday, JS Date.getDay convention).';

drop trigger if exists delivery_slots_updated_at on public.delivery_slots;
create trigger delivery_slots_updated_at before update on public.delivery_slots
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- schedule_blocks
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  block_date date not null,
  truck_id uuid null references public.trucks(id) on delete cascade,
  reason text null check (char_length(reason) <= 200),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id, block_date, truck_id)
);

create index if not exists schedule_blocks_org_date_idx on public.schedule_blocks(organization_id, block_date);

comment on table public.schedule_blocks is 'One-off blocked dates; truck_id null blocks all trucks for the org that date.';

-- ---------------------------------------------------------------------------
-- delivery_runs
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  run_date date not null,
  status public.delivery_run_status not null default 'planned',
  notes text null check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(truck_id, run_date)
);

create index if not exists delivery_runs_org_date_idx on public.delivery_runs(organization_id, run_date);

comment on table public.delivery_runs is 'A truck''s manifest for one delivery date; created on demand when the first order is confirmed onto it.';

drop trigger if exists delivery_runs_updated_at on public.delivery_runs;
create trigger delivery_runs_updated_at before update on public.delivery_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  created_by uuid null references auth.users(id) on delete set null,
  source text not null default 'portal' check (source in ('portal','manual')),
  status public.order_status not null default 'pending',
  zone_id uuid not null references public.delivery_zones(id) on delete restrict,
  delivery_address text not null check (char_length(delivery_address) <= 500),
  delivery_date date not null,
  slot_id uuid not null references public.delivery_slots(id) on delete restrict,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  run_id uuid null references public.delivery_runs(id) on delete set null,
  notes text null check (char_length(notes) <= 2000),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists orders_org_idx on public.orders(organization_id);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_org_created_idx on public.orders(organization_id, created_at desc);
create index if not exists orders_slot_date_idx on public.orders(slot_id, delivery_date);
create index if not exists orders_run_idx on public.orders(run_id);

comment on table public.orders is 'Unified order pipeline for portal (buyer) and manual (manager) orders. All writes go through security-definer RPCs.';

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  mode public.order_item_mode not null,
  quantity numeric(10,3) not null check (quantity > 0),
  size_min_kg numeric(6,3) not null check (size_min_kg > 0),
  size_max_kg numeric(6,3) not null,
  fallback public.order_fallback not null,
  fallback_applied public.order_fallback null,
  is_cancelled boolean not null default false,
  warehouse_weight_kg numeric(10,3) null check (warehouse_weight_kg > 0),
  warehouse_pieces integer null check (warehouse_pieces > 0),
  final_weight_kg numeric(10,3) null check (final_weight_kg > 0),
  final_pieces integer null check (final_pieces > 0),
  price_per_kg numeric(10,2) null check (price_per_kg >= 0),
  line_total numeric(12,2) generated always as (
    case when final_weight_kg is not null and price_per_kg is not null
      then round(final_weight_kg * price_per_kg, 2)
      else null
    end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (size_max_kg >= size_min_kg)
);

create index if not exists order_items_order_idx on public.order_items(order_id);

comment on table public.order_items is 'Order line items: mode (piece/kg), declared size range, and pre-declared fallback.';

drop trigger if exists order_items_updated_at on public.order_items;
create trigger order_items_updated_at before update on public.order_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.order_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  type text not null default 'allocate_weigh' check (type in ('allocate_weigh')),
  assigned_to uuid null references auth.users(id) on delete set null,
  status public.order_task_status not null default 'pending',
  done_by uuid null references auth.users(id) on delete set null,
  done_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(order_id, type)
);

create index if not exists order_tasks_org_status_idx on public.order_tasks(organization_id, status);

comment on table public.order_tasks is 'Warehouse staff assignment: allocate stock to the truck bay and weigh it. All writes go through security-definer RPCs.';

drop trigger if exists order_tasks_updated_at on public.order_tasks;
create trigger order_tasks_updated_at before update on public.order_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_weight_log
-- ---------------------------------------------------------------------------
create table if not exists public.order_weight_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  kind public.weight_log_kind not null,
  weight_kg numeric(10,3) not null check (weight_kg > 0),
  pieces integer null check (pieces > 0),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create index if not exists order_weight_log_item_idx on public.order_weight_log(order_item_id);

comment on table public.order_weight_log is 'Append-only audit trail of warehouse and final weight/piece readings. No update/delete policies -- all writes go through security-definer RPCs.';

-- ---------------------------------------------------------------------------
-- buyers.customer_id -- link a portal account to its CRM customer row
-- ---------------------------------------------------------------------------
alter table public.buyers add column if not exists customer_id uuid null references public.customers(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.delivery_zones enable row level security;
alter table public.trucks enable row level security;
alter table public.truck_zones enable row level security;
alter table public.delivery_slots enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.delivery_runs enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_tasks enable row level security;
alter table public.order_weight_log enable row level security;

-- delivery_zones: org members read all; public (incl. anon) reads active only; managers write.
create policy "delivery_zones_select" on public.delivery_zones
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "delivery_zones_select_public" on public.delivery_zones
  for select to anon, authenticated using (is_active = true);

create policy "delivery_zones_insert" on public.delivery_zones
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_zones_update" on public.delivery_zones
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_zones_delete" on public.delivery_zones
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- trucks: org members read; managers write.
create policy "trucks_select" on public.trucks
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "trucks_insert" on public.trucks
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "trucks_update" on public.trucks
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "trucks_delete" on public.trucks
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- truck_zones: org members read; managers insert/delete.
create policy "truck_zones_select" on public.truck_zones
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "truck_zones_insert" on public.truck_zones
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "truck_zones_delete" on public.truck_zones
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- delivery_slots: org members read; managers write.
create policy "delivery_slots_select" on public.delivery_slots
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "delivery_slots_insert" on public.delivery_slots
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_slots_update" on public.delivery_slots
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_slots_delete" on public.delivery_slots
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- schedule_blocks: org members read; managers insert/delete (no update).
create policy "schedule_blocks_select" on public.schedule_blocks
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "schedule_blocks_insert" on public.schedule_blocks
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "schedule_blocks_delete" on public.schedule_blocks
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- delivery_runs: org members read only; all writes via RPC.
create policy "delivery_runs_select" on public.delivery_runs
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- orders: org members read; buyers read their own; all writes via RPC.
create policy "orders_select_member" on public.orders
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "orders_select_buyer" on public.orders
  for select to authenticated using (created_by = auth.uid());

-- order_items: readable via the parent order's visibility; all writes via RPC.
create policy "order_items_select_member" on public.order_items
  for select to authenticated using (
    order_id in (
      select id from public.orders
      where organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid() and status = 'active'
      )
    )
  );

create policy "order_items_select_buyer" on public.order_items
  for select to authenticated using (
    order_id in (
      select id from public.orders where created_by = auth.uid()
    )
  );

-- order_tasks: org members read only; all writes via RPC.
create policy "order_tasks_select" on public.order_tasks
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- order_weight_log: org members read only; append-only via RPC (no write policies).
create policy "order_weight_log_select" on public.order_weight_log
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
--
-- CONTRACT CONCERN: the contract says "No explicit table GRANTs (Supabase
-- default grants apply)" -- verified empirically against the local stack
-- that this is false for tables owned by the migration role (`postgres`):
-- anon/authenticated get "permission denied for table X" (42501) at the
-- GRANT layer, before RLS is even evaluated, exactly like `products`,
-- `customers`, `orders` (old), and `buyers` do today (unexercised by any
-- test). The working precedent is `supabase/migrations/20260624000002_id_
-- access_rls.sql` / `20260625000005_id_access_and_structure_grants.sql`,
-- which issue explicit `grant select, insert, update, delete on <table> to
-- authenticated;` (and `grant select ... to anon` for public-read tables)
-- per table. This migration follows THAT precedent instead so the RLS
-- policies above are actually reachable; see the note at the end of this
-- plan file for the follow-up recommendation on the older catalog tables.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.delivery_zones,
  public.trucks,
  public.truck_zones,
  public.delivery_slots,
  public.schedule_blocks
to authenticated;

grant select on
  public.delivery_runs,
  public.orders,
  public.order_items,
  public.order_tasks,
  public.order_weight_log
to authenticated;

grant select on public.delivery_zones to anon;

commit;
```

- [ ] **Apply the migration:**

```
npm run db:reset
```

Expected: reset runs through all existing migrations, then `Applying migration 20260810000001_order_pipeline_schema.sql...` with no errors, ending `Finished supabase db reset on branch main.`

- [ ] **Run the test again and confirm it passes:**

```
npm run db:test
```

Expected output (tail):

```
/Users/alob/AyamNorliza-1/supabase/tests/rls/06_audit_log.sql ............. ok
/Users/alob/AyamNorliza-1/supabase/tests/rls/07_order_pipeline.sql ........ ok
/Users/alob/AyamNorliza-1/supabase/tests/rls/organizations.sql ............ ok
All tests successful.
Files=9, Tests=34,  0 wallclock secs (...)
Result: PASS
```

- [ ] **Regenerate types:**

```
npm run db:types
```

Expected: exits 0; `src/types/database.generated.ts` now contains `delivery_zones`, `trucks`, `truck_zones`, `delivery_slots`, `schedule_blocks`, `delivery_runs`, `orders`, `order_items`, `order_tasks`, `order_weight_log` table types and the 6 new enums under `Database["public"]["Enums"]`. Do not hand-edit this file.

- [ ] **Commit:**

```
git add supabase/migrations/20260810000001_order_pipeline_schema.sql supabase/tests/rls/07_order_pipeline.sql src/types/database.generated.ts
git commit -m "feat(orders): add order pipeline schema, RLS, and pgTAP coverage"
```

---

### Task 2: Order lifecycle RPCs

**Files:**
Create: `supabase/migrations/20260810000002_order_pipeline_functions.sql`
Create: `supabase/tests/rls/08_order_rpcs.sql`

**Interfaces:**
Consumes: Task 1's tables/enums (`public.orders`, `order_items`, `order_tasks`, `order_weight_log`, `delivery_runs`, `delivery_zones`, `delivery_slots`, `trucks`, `truck_zones`, `schedule_blocks`, `buyers.customer_id`), `public.has_org_role(uuid, text[])`, `public.audit_log` (existing, `supabase/migrations/20260624000001_id_access_core.sql`) and its existing `audit_log_insert_catalog` policy (`supabase/migrations/20260718000001_seller_role_and_catalog.sql`, already permits `entity_type = 'order'`).
Produces (consumed by `src/features/orders/server/portal-actions.ts` and `order-actions.ts` in later tasks via `supabase.rpc(...)`): `public.get_delivery_options(p_org uuid, p_zone uuid)`, `public.place_order(p_org uuid, p_zone uuid, p_slot uuid, p_date date, p_address text, p_notes text, p_items jsonb, p_customer uuid default null) returns uuid`, `public.confirm_order(p_order uuid, p_decisions jsonb)`, `public.complete_order_task(p_task uuid, p_weights jsonb)`, `public.set_run_status(p_run uuid, p_status public.delivery_run_status)`, `public.close_order(p_order uuid, p_lines jsonb) returns numeric`, `public.cancel_order(p_order uuid, p_reason text)`, `public.reopen_order(p_order uuid, p_reason text)`. All raise `errcode = 'P0001'` with a machine-readable `message` (`zone_not_found`, `slot_not_found`, `date_out_of_window`, `weekday_mismatch`, `date_blocked`, `slot_full`, `invalid_items`, `forbidden`, `decisions_incomplete`, `weights_incomplete`, `lines_incomplete`, `task_done`, `invalid_status`, `invalid_weight`, `invalid_price`, `invalid_transition`) that `order-actions.ts`'s `mapRpcError` (a later task) translates to friendly text.

- [ ] **Write the failing pgTAP test.** Create `supabase/tests/rls/08_order_rpcs.sql`:

```sql
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
```

- [ ] **Run it and confirm it fails** (the functions don't exist yet):

```
npm run db:test
```

Expected output (first and last failures shown; all 28 subtests fail with `42883: function public.<name>(...) does not exist`):

```
# Failed test 1: "place_order happy path (portal buyer) succeeds"
#       died: 42883: function public.place_order(uuid, uuid, uuid, date, unknown, unknown, jsonb) does not exist
#         HINT:       No function matches the given name and argument types. You might need to add explicit type casts.
...
# Failed test 28: "reopen writes an audit_log row"
# Looks like you failed 28 tests of 28
Failed 28/28 subtests

Test Summary Report
-------------------
/Users/alob/AyamNorliza-1/supabase/tests/rls/08_order_rpcs.sql          (Wstat: 0 Tests: 28 Failed: 28)
  Failed tests:  1-28
Files=10, Tests=62,  0 wallclock secs (...)
Result: FAIL
```

- [ ] **Write the migration.** Create `supabase/migrations/20260810000002_order_pipeline_functions.sql`:

```sql
-- 20260810000002_order_pipeline_functions.sql
-- Order lifecycle RPCs: get_delivery_options, place_order, confirm_order,
-- complete_order_task, set_run_status, close_order, cancel_order,
-- reopen_order. All security definer, search_path locked to public/pg_temp,
-- revoked from public and granted to authenticated only. Errors are raised
-- as `errcode = 'P0001'` with a machine-readable `message` the TS layer
-- maps to friendly text (see mapRpcError in order-actions.ts).

begin;

-- ---------------------------------------------------------------------------
-- get_delivery_options: zone -> valid (date, slot, truck) options for the
-- next 14 days starting tomorrow, minus blocked dates, minus full slots.
-- ---------------------------------------------------------------------------
create or replace function public.get_delivery_options(p_org uuid, p_zone uuid)
returns table (
  option_date date,
  slot_id uuid,
  truck_id uuid,
  truck_name text,
  start_time time,
  end_time time,
  remaining integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select option_date, slot_id, truck_id, truck_name, start_time, end_time, remaining
  from (
    select
      d::date as option_date,
      s.id as slot_id,
      t.id as truck_id,
      t.name as truck_name,
      s.start_time,
      s.end_time,
      case when s.max_orders is null then null
        else s.max_orders - (
          select count(*)::integer from public.orders o
          where o.slot_id = s.id and o.delivery_date = d::date and o.status <> 'cancelled'
        )
      end as remaining
    from generate_series(current_date + 1, current_date + 14, interval '1 day') as d
    join public.truck_zones tz on tz.zone_id = p_zone
    join public.trucks t on t.id = tz.truck_id and t.is_active = true and t.organization_id = p_org
    join public.delivery_slots s on s.truck_id = t.id and s.is_active = true
      and s.weekday = extract(dow from d)::smallint
    where not exists (
      select 1 from public.schedule_blocks b
      where b.organization_id = p_org
        and b.block_date = d::date
        and (b.truck_id is null or b.truck_id = t.id)
    )
  ) options
  where remaining is null or remaining > 0
  order by option_date, start_time;
$$;

revoke all on function public.get_delivery_options(uuid, uuid) from public;
grant execute on function public.get_delivery_options(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- place_order: validates zone/slot/date/capacity/items, resolves the
-- customer (portal buyer or manager-picked), inserts the order + items.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_org uuid,
  p_zone uuid,
  p_slot uuid,
  p_date date,
  p_address text,
  p_notes text,
  p_items jsonb,
  p_customer uuid default null
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
  v_mode text;
  v_fallback text;
  v_quantity numeric;
  v_size_min numeric;
  v_size_max numeric;
begin
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
    if not public.has_org_role(p_org, array['owner', 'org_admin', 'seller']) then
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
    v_mode := v_item->>'mode';
    v_fallback := v_item->>'fallback';
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_size_min := nullif(v_item->>'sizeMinKg', '')::numeric;
    v_size_max := nullif(v_item->>'sizeMaxKg', '')::numeric;

    if v_mode not in ('piece', 'kg') or v_fallback not in ('cancel', 'mix', 'upsize', 'downsize') then
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
      where id = nullif(v_item->>'productId', '')::uuid
        and organization_id = p_org
        and is_active = true
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_items';
    end if;
  end loop;

  insert into public.orders (
    organization_id, customer_id, created_by, source, status,
    zone_id, delivery_address, delivery_date, slot_id, truck_id, notes
  ) values (
    p_org, v_customer_id, auth.uid(), v_source, 'pending',
    p_zone, p_address, p_date, p_slot, v_truck_id, p_notes
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, mode, quantity, size_min_kg, size_max_kg, fallback
    ) values (
      v_order_id,
      (v_item->>'productId')::uuid,
      (v_item->>'mode')::public.order_item_mode,
      (v_item->>'quantity')::numeric,
      (v_item->>'sizeMinKg')::numeric,
      (v_item->>'sizeMaxKg')::numeric,
      (v_item->>'fallback')::public.order_fallback
    );
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid) from public;
grant execute on function public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_order: manager stock check. Applies pre-declared fallback to
-- unavailable lines; cancels the order if every line ends up cancelled;
-- otherwise attaches the order to its truck+date delivery_runs row and
-- creates the allocate_weigh task.
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
  v_all_cancelled boolean;
  v_run_id uuid;
begin
  select organization_id, status, truck_id, delivery_date
    into v_org, v_status, v_truck_id, v_delivery_date
  from public.orders where id = p_order;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  select count(*) into v_item_count from public.order_items where order_id = p_order;

  if (
    select count(distinct (d.value->>'item_id')::uuid) from jsonb_array_elements(p_decisions) d
  ) <> v_item_count
  or exists (
    select 1 from jsonb_array_elements(p_decisions) d
    where not exists (
      select 1 from public.order_items oi
      where oi.id = (d.value->>'item_id')::uuid and oi.order_id = p_order
    )
  ) then
    raise exception using errcode = 'P0001', message = 'decisions_incomplete';
  end if;

  for v_decision in select * from jsonb_array_elements(p_decisions)
  loop
    if (v_decision->>'available')::boolean = false then
      update public.order_items
      set fallback_applied = fallback,
          is_cancelled = (fallback = 'cancel')
      where id = (v_decision->>'item_id')::uuid and order_id = p_order;
    end if;
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
-- complete_order_task: staff key warehouse weight/pieces per line, mark the
-- task done, move the order to ready.
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
  v_item_count integer;
  v_weight jsonb;
  v_weight_kg numeric;
  v_pieces integer;
begin
  select ot.organization_id, ot.order_id, ot.status, o.status
    into v_org, v_order_id, v_task_status, v_order_status
  from public.order_tasks ot
  join public.orders o on o.id = ot.order_id
  where ot.id = p_task;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'inventory', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_task_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'task_done';
  end if;

  if v_order_status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  select count(*) into v_item_count
  from public.order_items where order_id = v_order_id and is_cancelled = false;

  if (
    select count(distinct (w.value->>'item_id')::uuid) from jsonb_array_elements(p_weights) w
  ) <> v_item_count
  or exists (
    select 1 from jsonb_array_elements(p_weights) w
    where not exists (
      select 1 from public.order_items oi
      where oi.id = (w.value->>'item_id')::uuid and oi.order_id = v_order_id and oi.is_cancelled = false
    )
  ) then
    raise exception using errcode = 'P0001', message = 'weights_incomplete';
  end if;

  for v_weight in select * from jsonb_array_elements(p_weights)
  loop
    v_weight_kg := nullif(v_weight->>'weight_kg', '')::numeric;
    v_pieces := nullif(v_weight->>'pieces', '')::integer;

    if v_weight_kg is null or v_weight_kg <= 0 then
      raise exception using errcode = 'P0001', message = 'invalid_weight';
    end if;

    update public.order_items
    set warehouse_weight_kg = v_weight_kg, warehouse_pieces = v_pieces
    where id = (v_weight->>'item_id')::uuid and order_id = v_order_id;

    insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
    values (v_org, (v_weight->>'item_id')::uuid, 'warehouse', v_weight_kg, v_pieces, auth.uid());
  end loop;

  update public.order_tasks
  set status = 'done', done_by = auth.uid(), done_at = now()
  where id = p_task;

  update public.orders set status = 'ready' where id = v_order_id;
end;
$$;

revoke all on function public.complete_order_task(uuid, jsonb) from public;
grant execute on function public.complete_order_task(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- set_run_status: manager marks a run departed/completed. Completing a run
-- delivers every 'ready' order riding on it.
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

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not (
    (v_current = 'planned' and p_status = 'departed')
    or (v_current = 'departed' and p_status = 'completed')
    or (v_current = 'planned' and p_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
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
-- close_order: manager keys final weight/pieces/price per line; total =
-- sum of the generated line_total for non-cancelled lines.
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
  v_weight numeric;
  v_price numeric;
  v_pieces integer;
  v_total numeric;
begin
  select organization_id, status into v_org, v_status from public.orders where id = p_order;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status <> 'delivered' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  select count(*) into v_item_count
  from public.order_items where order_id = p_order and is_cancelled = false;

  if (
    select count(distinct (l.value->>'item_id')::uuid) from jsonb_array_elements(p_lines) l
  ) <> v_item_count
  or exists (
    select 1 from jsonb_array_elements(p_lines) l
    where not exists (
      select 1 from public.order_items oi
      where oi.id = (l.value->>'item_id')::uuid and oi.order_id = p_order and oi.is_cancelled = false
    )
  ) then
    raise exception using errcode = 'P0001', message = 'lines_incomplete';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_weight := nullif(v_line->>'final_weight_kg', '')::numeric;
    v_price := nullif(v_line->>'price_per_kg', '')::numeric;
    v_pieces := nullif(v_line->>'final_pieces', '')::integer;

    if v_weight is null or v_weight <= 0 then
      raise exception using errcode = 'P0001', message = 'invalid_weight';
    end if;

    if v_price is null or v_price < 0 then
      raise exception using errcode = 'P0001', message = 'invalid_price';
    end if;

    update public.order_items
    set final_weight_kg = v_weight, final_pieces = v_pieces, price_per_kg = v_price
    where id = (v_line->>'item_id')::uuid and order_id = p_order;

    insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
    values (v_org, (v_line->>'item_id')::uuid, 'final', v_weight, v_pieces, auth.uid());
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
-- cancel_order: manager cancels any order not yet closed/cancelled; a
-- non-member may only cancel their own order while it is still pending.
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
  select organization_id, status, created_by into v_org, v_status, v_created_by from public.orders where id = p_order;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  v_is_manager := public.has_org_role(v_org, array['owner', 'org_admin', 'seller']);

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
-- reopen_order: owner/org_admin only. Audit-logged.
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
  select organization_id, status into v_org, v_status from public.orders where id = p_order;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin']) then
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

commit;
```

- [ ] **Apply the migration and confirm the test passes:**

```
npm run db:reset
npm run db:test
```

Expected output (tail):

```
/Users/alob/AyamNorliza-1/supabase/tests/rls/07_order_pipeline.sql ........ ok
/Users/alob/AyamNorliza-1/supabase/tests/rls/08_order_rpcs.sql ............ ok
/Users/alob/AyamNorliza-1/supabase/tests/rls/organizations.sql ............ ok
All tests successful.
Files=10, Tests=62,  0 wallclock secs (...)
Result: PASS
```

- [ ] **Commit:**

```
git add supabase/migrations/20260810000002_order_pipeline_functions.sql supabase/tests/rls/08_order_rpcs.sql
git commit -m "feat(orders): add order lifecycle RPCs (place/confirm/complete/close/cancel/reopen)"
```

---

### Task 3: Pilot seed migration

**Files:**
Create: `supabase/migrations/20260810000003_order_pipeline_seed.sql`
Test: verified with `npm run db:reset` + a manual psql check query (no pgTAP file -- seed data isn't RLS-gated behavior, it's idempotent fixture data; the RLS/RPC behavior it feeds is already covered by Tasks 1-2's tests and by the e2e suite in a later task).

**Interfaces:**
Consumes: Task 1's `public.delivery_zones`, `trucks`, `truck_zones`, `delivery_slots`, `buyers` tables; existing `public.organizations` (slug `ayam-norliza-pilot`, seeded by `20260624000004_id_access_seed.sql`), existing owner user `owner@ayam-norliza-pilot.example` (seeded by the same migration), existing `public.customers` table, and the auth-user-seeding pattern from `20260710000001_create_owner_account.sql` / `20260624000004_id_access_seed.sql` (`auth.users` + `auth.identities` inserts with `crypt(..., gen_salt('bf'))`).
Produces: 3 delivery zones (`Zone 1/2/3`), 2 trucks (`TRK-A` covering zones 1+2, `TRK-B` covering zone 3), 24 delivery slots (2 trucks x 6 weekdays x 2 time windows, `max_orders = 10`), and an e2e buyer fixture (`buyer@ayam-norliza-pilot.example` / `test-only-password-12-chars`, linked `public.buyers` row + `public.customers` row) -- consumed by the Playwright e2e specs in a later task (`pilot org slug used in e2e: ayam-norliza-pilot`, per the contract).

Since this task seeds fixture data rather than adding testable schema/behavior, there is no separate "write failing test" step -- the check step below is the verification.

- [ ] **Write the migration.** Create `supabase/migrations/20260810000003_order_pipeline_seed.sql`:

```sql
-- 20260810000003_order_pipeline_seed.sql
-- Pilot org delivery setup + an e2e buyer fixture for Playwright.
-- Idempotent: safe to re-run on every `supabase db reset`.

begin;

-- ---------------------------------------------------------------------------
-- 3 delivery zones
-- ---------------------------------------------------------------------------
insert into public.delivery_zones (id, organization_id, name, display_order, created_by)
select z.id, o.id, z.name, z.display_order, u.id
from (
  values
    ('30000000-0000-0000-0000-000000000001'::uuid, 'Zone 1', 0),
    ('30000000-0000-0000-0000-000000000002'::uuid, 'Zone 2', 1),
    ('30000000-0000-0000-0000-000000000003'::uuid, 'Zone 3', 2)
) as z(id, name, display_order)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
cross join (select id from auth.users where email = 'owner@ayam-norliza-pilot.example') as u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2 trucks
-- ---------------------------------------------------------------------------
insert into public.trucks (id, organization_id, name, code, created_by)
select t.id, o.id, t.name, t.code, u.id
from (
  values
    ('30000000-0000-0000-0000-000000000011'::uuid, 'Truck A', 'TRK-A'),
    ('30000000-0000-0000-0000-000000000012'::uuid, 'Truck B', 'TRK-B')
) as t(id, name, code)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
cross join (select id from auth.users where email = 'owner@ayam-norliza-pilot.example') as u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Truck coverage: TRK-A -> Zone 1 + Zone 2; TRK-B -> Zone 3
-- ---------------------------------------------------------------------------
insert into public.truck_zones (truck_id, zone_id, organization_id)
select tz.truck_id, tz.zone_id, o.id
from (
  values
    ('30000000-0000-0000-0000-000000000011'::uuid, '30000000-0000-0000-0000-000000000001'::uuid),
    ('30000000-0000-0000-0000-000000000011'::uuid, '30000000-0000-0000-0000-000000000002'::uuid),
    ('30000000-0000-0000-0000-000000000012'::uuid, '30000000-0000-0000-0000-000000000003'::uuid)
) as tz(truck_id, zone_id)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
on conflict (truck_id, zone_id) do nothing;

-- ---------------------------------------------------------------------------
-- Slots: Mon-Sat (weekday 1-6, JS Date.getDay convention), 09:00-12:00 and
-- 14:00-17:00, both trucks, max_orders 10. No unique constraint on
-- (truck_id, weekday, start_time) exists, so idempotency is a NOT EXISTS
-- guard rather than ON CONFLICT.
-- ---------------------------------------------------------------------------
insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, max_orders, created_by)
select o.id, t.truck_id, wd.weekday, tw.start_time, tw.end_time, 10, u.id
from (
  values ('30000000-0000-0000-0000-000000000011'::uuid), ('30000000-0000-0000-0000-000000000012'::uuid)
) as t(truck_id)
cross join (values (1), (2), (3), (4), (5), (6)) as wd(weekday)
cross join (values ('09:00'::time, '12:00'::time), ('14:00'::time, '17:00'::time)) as tw(start_time, end_time)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
cross join (select id from auth.users where email = 'owner@ayam-norliza-pilot.example') as u
where not exists (
  select 1 from public.delivery_slots s
  where s.truck_id = t.truck_id and s.weekday = wd.weekday and s.start_time = tw.start_time
);

-- ---------------------------------------------------------------------------
-- E2E buyer fixture: buyer@ayam-norliza-pilot.example, same deterministic
-- password convention as the other local E2E users.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '30000000-0000-0000-0000-000000000099',
  'authenticated',
  'authenticated',
  'buyer@ayam-norliza-pilot.example',
  crypt('test-only-password-12-chars', gen_salt('bf')),
  now(), '', '', '', '', '', '', '', '',
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object('display_name', 'E2E Pilot Buyer'),
  false, now(), now(), false, false
)
on conflict (id) do update
  set email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at,
      updated_at = now();

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  'buyer@ayam-norliza-pilot.example',
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(), now(), now()
from auth.users u
where u.email = 'buyer@ayam-norliza-pilot.example'
on conflict (provider, provider_id) do update
  set user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

insert into public.buyers (id, organization_id, display_name, phone)
select u.id, o.id, 'E2E Pilot Buyer', '0123456789'
from auth.users u
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
where u.email = 'buyer@ayam-norliza-pilot.example'
on conflict (id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      updated_at = now();

-- Linked customers row so the buyer already has an order-ready CRM identity.
insert into public.customers (id, organization_id, name, phone, created_by)
select '30000000-0000-0000-0000-0000000000aa', o.id, 'E2E Pilot Buyer', '0123456789', u.id
from auth.users u
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
where u.email = 'buyer@ayam-norliza-pilot.example'
on conflict (id) do nothing;

update public.buyers
set customer_id = '30000000-0000-0000-0000-0000000000aa'
where id = (select id from auth.users where email = 'buyer@ayam-norliza-pilot.example')
  and customer_id is distinct from '30000000-0000-0000-0000-0000000000aa'::uuid;

commit;
```

- [ ] **Apply it:**

```
npm run db:reset
```

Expected: tail of the output includes `Applying migration 20260810000003_order_pipeline_seed.sql...` with no errors, ending `Finished supabase db reset on branch main.`

- [ ] **Verify with a psql check query** (`npx supabase db` prints the local connection string; the local Postgres port is `54322` from `supabase/config.toml`):

```
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
select
  (select count(*) from public.delivery_zones z join public.organizations o on o.id = z.organization_id where o.slug = 'ayam-norliza-pilot') as zones,
  (select count(*) from public.trucks t join public.organizations o on o.id = t.organization_id where o.slug = 'ayam-norliza-pilot') as trucks,
  (select count(*) from public.truck_zones tz join public.organizations o on o.id = tz.organization_id where o.slug = 'ayam-norliza-pilot') as truck_zones,
  (select count(*) from public.delivery_slots s join public.organizations o on o.id = s.organization_id where o.slug = 'ayam-norliza-pilot') as slots,
  (select count(*) from auth.users where email = 'buyer@ayam-norliza-pilot.example') as buyer_auth_user,
  (select count(*) from public.buyers b where b.id = (select id from auth.users where email = 'buyer@ayam-norliza-pilot.example') and b.customer_id is not null) as buyer_linked;
"
```

Expected output:

```
 zones | trucks | truck_zones | slots | buyer_auth_user | buyer_linked
-------+--------+-------------+-------+-----------------+--------------
     3 |      2 |           3 |    24 |               1 |            1
(1 row)
```

- [ ] **Verify idempotency** by running `npm run db:reset` a second time and repeating the check query above -- the same six numbers must come back unchanged (no duplicate zones/trucks/slots, no duplicate buyer). This has been verified: re-running the migration's SQL directly against an already-seeded database produces `INSERT 0 0` for the zone/truck/truck_zone/slot statements (all already exist, `on conflict do nothing` / `where not exists` no-ops) and `INSERT 0 1` / `UPDATE 0` for the buyer upsert statements (which always touch exactly the one existing row), with the check query returning the identical `3 | 2 | 3 | 24 | 1 | 1` row.

- [ ] **Commit:**

```
git add supabase/migrations/20260810000003_order_pipeline_seed.sql
git commit -m "feat(orders): seed pilot delivery zones/trucks/slots and e2e buyer fixture"
```

---

CONTRACT CONCERN: the contract states "No explicit table GRANTs (Supabase default grants apply) -- match this" and shows RLS policy patterns without a `to <role>` clause (`for select using (...)`). Both are followed literally by the two most recent catalog-era migrations (`20260718000001_seller_role_and_catalog.sql`, `20260718120000_buyer_portal.sql`) that this contract cites as precedent. I verified against a live local Supabase stack that this precedent is actually broken: `anon` and `authenticated` have no SELECT/INSERT/UPDATE/DELETE grant on any table created by those migrations (`products`, `customers`, `orders` (old), `buyer_orders`, `buyers`, etc.) -- every query against them fails with `permission denied for table X` (42501) at the grant layer, before RLS is even evaluated. This includes today's real request path: `createSupabaseServerClient()` (`src/lib/supabase/server.ts`) authenticates with the anon key, so an unauthenticated buyer-portal visitor runs as the `anon` Postgres role and a signed-in user runs as `authenticated` -- both blocked. It has gone unnoticed because no pgTAP test or e2e test exercises real row access on these tables (existing RLS tests 01-06 only assert `relrowsecurity = true` and that `anon` gets 42501 on tables that were never meant to be anon-readable in the first place, which reads the same whether the denial comes from a missing GRANT or from RLS). The working, exercised precedent in this codebase is the `id_access` migrations (`20260624000002_id_access_rls.sql`, `20260625000005_id_access_and_structure_grants.sql`), which always pair every new table with an explicit `grant select, insert, update, delete on <table> to authenticated;` (or `grant select on <table> to authenticated;` for RPC/audit-only tables), plus `grant select on <table> to anon;` for anything meant to be publicly readable.

Given that this plan's own required pgTAP coverage ("anon reads active delivery_zones", "manager can insert delivery_zones") would be unable to pass without functioning grants, Task 1's migration follows the `id_access` grant precedent instead of the literal "no explicit grants" instruction, and additionally scopes every new RLS policy with `to authenticated` (or `to anon, authenticated` for the one public policy) rather than leaving policies unscoped. The scoping is not cosmetic: with unscoped policies, a query from the `anon` role against `delivery_zones` still triggers evaluation of the org-membership policy (`delivery_zones_select`, which subqueries `organization_members`) because Postgres folds every applicable permissive policy into the plan regardless of whether the role could ever satisfy it -- and `anon` has no grant on `organization_members` either, so the query fails with `permission denied for table organization_members` even after `delivery_zones` itself is granted to anon. This was reproduced live before adding `to authenticated` / `to anon, authenticated`, and confirmed fixed after. Recommend a follow-up migration to add the missing grants to the older catalog/buyer-portal tables (`categories`, `products`, `product_variants`, `customers`, `buyers`, `buyer_orders`, `buyer_order_items`) and scope their unscoped policies the same way -- out of scope for this plan's Tasks 1-3, flagged here for the team.

CONTRACT CONCERN: `place_order`'s manual-order branch ("Else: `has_org_role(p_org, manager)` required, customer must belong to org") has no error code specified in the contract for the "customer must belong to org" case -- the contract's code list for `place_order` only has `zone_not_found, slot_not_found, date_out_of_window, weekday_mismatch, date_blocked, slot_full, invalid_items`. I reused `forbidden` (already a documented code in the `mapRpcError` list) for both the not-a-manager case and the customer-foreign-org case rather than inventing a new undocumented code.

CONTRACT CONCERN: none of the 8 RPCs have a documented "not found" error code for an invalid/nonexistent `p_order` / `p_run` / `p_task` id -- the contract only documents status-mismatch codes (`invalid_status`, `invalid_transition`, `task_done`). Every function in this plan treats "id not found" as indistinguishable from "id found but in the wrong state" and raises the same status code (`invalid_status` for order-keyed functions, `invalid_transition` for `set_run_status`). This is consistent across all 8 functions and matches the TS layer's documented `mapRpcError` code list (no `*_not_found` code exists there for orders/runs/tasks), so no new code was invented.
### Task 4: Orders feature types + schemas

**Files:**
Create: `src/features/orders/types.ts`
Test: `src/features/orders/tests/unit/types.test.ts`

**Interfaces:**
Consumes: none (foundational — pure types/zod, no imports from other order-pipeline modules).
Produces (exact — every symbol later tasks import from `@/features/orders/types` or the relative equivalent):
```ts
export const ORDER_STATUSES: readonly ["pending","confirmed","ready","delivered","closed","cancelled"];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string>;
export const ORDER_STATUS_COLORS: Record<OrderStatus, string>;
export type OrderItemMode = "piece" | "kg";
export const FALLBACKS: readonly ["cancel","mix","upsize","downsize"];
export type OrderFallback = (typeof FALLBACKS)[number];
export const FALLBACK_LABELS: Record<OrderFallback, string>;
export type RunStatus = "planned" | "departed" | "completed";
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };
export type DeliveryZone; export type Truck; export type TruckZone; export type DeliverySlot;
export type ScheduleBlock; export type DeliveryRun; export type Order; export type OrderItem;
export type OrderTask; export type OrderWeightLog;
export type DeliveryOption; export type OrderItemWithProduct; export type OrderWithItems;
export type OrderListItem; export type TaskWithOrder; export type RunWithOrders; export type DeliverySetup;
export const OrderItemInputSchema; export type OrderItemInput;
export const PlaceOrderSchema; export type PlaceOrderInput;
export const ConfirmOrderSchema; export type ConfirmOrderInput;
export const CompleteTaskSchema; export type CompleteTaskInput;
export const CloseOrderSchema; export type CloseOrderInput;
export const ZoneInputSchema; export type ZoneInput;
export const TruckInputSchema; export type TruckInput;
export const SlotInputSchema; export type SlotInput;
export const BlockInputSchema; export type BlockInput;
```

- [ ] Create the test directory and write the failing test `src/features/orders/tests/unit/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BlockInputSchema,
  CloseOrderSchema,
  CompleteTaskSchema,
  ConfirmOrderSchema,
  FALLBACK_LABELS,
  FALLBACKS,
  OrderItemInputSchema,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  PlaceOrderSchema,
  SlotInputSchema,
  ZoneInputSchema,
} from "../../types";

const validItem = {
  productId: "11111111-1111-1111-1111-111111111111",
  mode: "kg" as const,
  quantity: 1.5,
  sizeMinKg: 1.5,
  sizeMaxKg: 1.7,
  fallback: "mix" as const,
};

describe("OrderItemInputSchema", () => {
  it("rejects non-integer quantity in piece mode", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      mode: "piece",
      quantity: 1.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.quantity?.[0]).toBeDefined();
    }
  });

  it("accepts integer quantity in piece mode", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      mode: "piece",
      quantity: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts decimal quantity in kg mode", () => {
    const result = OrderItemInputSchema.safeParse({ ...validItem, mode: "kg", quantity: 1.234 });
    expect(result.success).toBe(true);
  });

  it("rejects sizeMaxKg below sizeMinKg", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      sizeMinKg: 2,
      sizeMaxKg: 1.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.sizeMaxKg?.[0]).toBeDefined();
    }
  });

  it("accepts sizeMaxKg equal to sizeMinKg", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      sizeMinKg: 1.6,
      sizeMaxKg: 1.6,
    });
    expect(result.success).toBe(true);
  });
});

describe("PlaceOrderSchema", () => {
  const base = {
    organizationSlug: "ayam-norliza-pilot",
    zoneId: "11111111-1111-1111-1111-111111111111",
    slotId: "22222222-2222-2222-2222-222222222222",
    address: "123 Jalan Ayam",
    items: [validItem],
  };

  it("accepts a well-formed ISO date", () => {
    const result = PlaceOrderSchema.safeParse({ ...base, deliveryDate: "2026-08-11" });
    expect(result.success).toBe(true);
  });

  it("rejects a slash-formatted date", () => {
    const result = PlaceOrderSchema.safeParse({ ...base, deliveryDate: "08/11/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects a date with a time component", () => {
    const result = PlaceOrderSchema.safeParse({
      ...base,
      deliveryDate: "2026-08-11T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a single-digit month/day date", () => {
    const result = PlaceOrderSchema.safeParse({ ...base, deliveryDate: "2026-8-1" });
    expect(result.success).toBe(false);
  });
});

describe("CompleteTaskSchema", () => {
  const base = {
    organizationSlug: "ayam-norliza-pilot",
    taskId: "11111111-1111-1111-1111-111111111111",
  };

  it("rejects zero weightKg", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative weightKg", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: -5 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts weightKg at the upper bound of 1000", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: 1000 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects weightKg above 1000", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: 1000.1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional integer pieces value", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [
        { itemId: "22222222-2222-2222-2222-222222222222", weightKg: 12.5, pieces: 8 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("FALLBACK_LABELS completeness", () => {
  it("has exactly one label per FALLBACKS entry, in the same set", () => {
    expect(Object.keys(FALLBACK_LABELS).sort()).toEqual([...FALLBACKS].sort());
  });

  it("every label is a non-empty string", () => {
    for (const key of FALLBACKS) {
      expect(typeof FALLBACK_LABELS[key]).toBe("string");
      expect(FALLBACK_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it("matches the exact copy from the design", () => {
    expect(FALLBACK_LABELS.cancel).toBe("Cancel my order");
    expect(FALLBACK_LABELS.mix).toBe("Mix sizes");
    expect(FALLBACK_LABELS.upsize).toBe("Bigger is ok");
    expect(FALLBACK_LABELS.downsize).toBe("Smaller is ok");
  });
});

describe("ORDER_STATUS_LABELS and ORDER_STATUS_COLORS completeness", () => {
  it("has exactly one label and one color per ORDER_STATUSES entry", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...ORDER_STATUSES].sort());
    expect(Object.keys(ORDER_STATUS_COLORS).sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe("ConfirmOrderSchema", () => {
  it("requires at least one decision", () => {
    const result = ConfirmOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      decisions: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed decision list", () => {
    const result = ConfirmOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      decisions: [{ itemId: "22222222-2222-2222-2222-222222222222", available: false }],
    });
    expect(result.success).toBe(true);
  });
});

describe("CloseOrderSchema", () => {
  it("rejects a negative pricePerKg", () => {
    const result = CloseOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      lines: [
        {
          itemId: "22222222-2222-2222-2222-222222222222",
          finalWeightKg: 12,
          pricePerKg: -1,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts pricePerKg of zero (nonnegative)", () => {
    const result = CloseOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      lines: [
        {
          itemId: "22222222-2222-2222-2222-222222222222",
          finalWeightKg: 12,
          pricePerKg: 0,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("ZoneInputSchema", () => {
  it("defaults displayOrder and isActive when omitted", () => {
    const result = ZoneInputSchema.safeParse({ name: "Zone 1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayOrder).toBe(0);
      expect(result.data.isActive).toBe(true);
    }
  });
});

describe("SlotInputSchema", () => {
  const base = {
    truckId: "11111111-1111-1111-1111-111111111111",
    weekday: 1,
    maxOrders: 10,
  };

  it("rejects endTime not after startTime", () => {
    const result = SlotInputSchema.safeParse({
      ...base,
      startTime: "12:00",
      endTime: "09:00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts endTime after startTime", () => {
    const result = SlotInputSchema.safeParse({
      ...base,
      startTime: "09:00",
      endTime: "12:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null maxOrders", () => {
    const result = SlotInputSchema.safeParse({
      ...base,
      maxOrders: null,
      startTime: "09:00",
      endTime: "12:00",
    });
    expect(result.success).toBe(true);
  });
});

describe("BlockInputSchema", () => {
  it("accepts a null truckId (all trucks blocked)", () => {
    const result = BlockInputSchema.safeParse({
      blockDate: "2026-12-25",
      truckId: null,
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] Run it and confirm it fails because `src/features/orders/types.ts` does not exist yet:

```
npx vitest run src/features/orders/tests/unit/types.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1

 ❯ src/features/orders/tests/unit/types.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/features/orders/tests/unit/types.test.ts [ src/features/orders/tests/unit/types.test.ts ]
Error: Cannot find module '../../types' imported from /Users/alob/AyamNorliza-1/src/features/orders/tests/unit/types.test.ts
 ❯ src/features/orders/tests/unit/types.test.ts:2:1
      1| import { describe, expect, it } from "vitest";
      2| import {
       | ^
      3|   BlockInputSchema,
      4|   CloseOrderSchema,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] Create `src/features/orders/types.ts` with the full implementation:

```ts
/**
 * Orders feature types and schemas: the unified pipeline shared by the
 * buyer portal (portal-actions), the seller ops screens (order-actions),
 * and delivery schedule admin (schedule-actions).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Order status
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "ready",
  "delivered",
  "closed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  ready: "Ready",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: "bg-blue-100 text-blue-800",
  confirmed: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-800",
  delivered: "bg-purple-100 text-purple-800",
  closed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
};

// ---------------------------------------------------------------------------
// Order item mode + fallback
// ---------------------------------------------------------------------------

export type OrderItemMode = "piece" | "kg";

export const FALLBACKS = ["cancel", "mix", "upsize", "downsize"] as const;
export type OrderFallback = (typeof FALLBACKS)[number];

export const FALLBACK_LABELS: Record<OrderFallback, string> = {
  cancel: "Cancel my order",
  mix: "Mix sizes",
  upsize: "Bigger is ok",
  downsize: "Smaller is ok",
};

export type RunStatus = "planned" | "departed" | "completed";

// ---------------------------------------------------------------------------
// ActionResult
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

// ---------------------------------------------------------------------------
// Row types (snake_case fields mirroring the DB)
// ---------------------------------------------------------------------------

export type DeliveryZone = {
  id: string;
  organization_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type Truck = {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type TruckZone = {
  truck_id: string;
  zone_id: string;
  organization_id: string;
};

export type DeliverySlot = {
  id: string;
  organization_id: string;
  truck_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  max_orders: number | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type ScheduleBlock = {
  id: string;
  organization_id: string;
  block_date: string;
  truck_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type DeliveryRun = {
  id: string;
  organization_id: string;
  truck_id: string;
  run_date: string;
  status: RunStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type Order = {
  id: string;
  organization_id: string;
  customer_id: string;
  created_by: string | null;
  source: "portal" | "manual";
  status: OrderStatus;
  zone_id: string;
  delivery_address: string;
  delivery_date: string;
  slot_id: string;
  truck_id: string;
  run_id: string | null;
  notes: string | null;
  total_amount: number;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  mode: OrderItemMode;
  quantity: number;
  size_min_kg: number;
  size_max_kg: number;
  fallback: OrderFallback;
  fallback_applied: OrderFallback | null;
  is_cancelled: boolean;
  warehouse_weight_kg: number | null;
  warehouse_pieces: number | null;
  final_weight_kg: number | null;
  final_pieces: number | null;
  price_per_kg: number | null;
  line_total: number | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type OrderTask = {
  id: string;
  organization_id: string;
  order_id: string;
  type: "allocate_weigh";
  assigned_to: string | null;
  status: "pending" | "done";
  done_by: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type OrderWeightLog = {
  id: string;
  organization_id: string;
  order_item_id: string;
  kind: "warehouse" | "final";
  weight_kg: number;
  pieces: number | null;
  recorded_by: string;
  recorded_at: string;
};

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

export type DeliveryOption = {
  date: string;
  slotId: string;
  truckId: string;
  truckName: string;
  startTime: string;
  endTime: string;
  remaining: number | null;
};

export type OrderItemWithProduct = OrderItem & {
  product?: { id: string; name: string; image_url: string | null };
};

export type OrderWithItems = Order & {
  items: OrderItemWithProduct[];
  zone?: DeliveryZone;
  slot?: DeliverySlot;
  truck?: Truck;
  customer?: { id: string; name: string; phone: string };
  tasks?: OrderTask[];
  weight_log?: OrderWeightLog[];
};

export type OrderListItem = Order & {
  customer?: { name: string };
  zone?: { name: string };
};

export type TaskWithOrder = OrderTask & { order: OrderWithItems };

export type RunWithOrders = DeliveryRun & { truck?: Truck; orders: OrderWithItems[] };

export type DeliverySetup = {
  zones: DeliveryZone[];
  trucks: Truck[];
  truckZones: TruckZone[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
};

// ---------------------------------------------------------------------------
// Zod schemas (all inputs are `unknown` -> safeParse in server actions)
// ---------------------------------------------------------------------------

export const OrderItemInputSchema = z
  .object({
    productId: z.string().uuid(),
    mode: z.enum(["piece", "kg"]),
    quantity: z.number().positive(),
    sizeMinKg: z.number().min(0.1).max(50),
    sizeMaxKg: z.number().min(0.1).max(50),
    fallback: z.enum(FALLBACKS),
  })
  .refine((v) => v.mode !== "piece" || Number.isInteger(v.quantity), {
    message: "Quantity must be a whole number for piece orders",
    path: ["quantity"],
  })
  .refine((v) => v.sizeMaxKg >= v.sizeMinKg, {
    message: "Maximum size must be greater than or equal to minimum size",
    path: ["sizeMaxKg"],
  });
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

export const PlaceOrderSchema = z.object({
  organizationSlug: z.string().min(1),
  zoneId: z.string().uuid(),
  slotId: z.string().uuid(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  address: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
  items: z.array(OrderItemInputSchema).min(1),
  customerId: z.string().uuid().optional(),
});
export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;

export const ConfirmOrderSchema = z.object({
  organizationSlug: z.string().min(1),
  orderId: z.string().uuid(),
  decisions: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        available: z.boolean(),
      }),
    )
    .min(1),
});
export type ConfirmOrderInput = z.infer<typeof ConfirmOrderSchema>;

export const CompleteTaskSchema = z.object({
  organizationSlug: z.string().min(1),
  taskId: z.string().uuid(),
  weights: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        weightKg: z.number().positive().max(1000),
        pieces: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

export const CloseOrderSchema = z.object({
  organizationSlug: z.string().min(1),
  orderId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        finalWeightKg: z.number().positive().max(10000),
        finalPieces: z.number().int().positive().optional(),
        pricePerKg: z.number().nonnegative().max(10000),
      }),
    )
    .min(1),
});
export type CloseOrderInput = z.infer<typeof CloseOrderSchema>;

export const ZoneInputSchema = z.object({
  name: z.string().min(1).max(100),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type ZoneInput = z.infer<typeof ZoneInputSchema>;

export const TruckInputSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  isActive: z.boolean().default(true),
});
export type TruckInput = z.infer<typeof TruckInputSchema>;

export const SlotInputSchema = z
  .object({
    truckId: z.string().uuid(),
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    maxOrders: z.number().int().positive().nullable(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });
export type SlotInput = z.infer<typeof SlotInputSchema>;

export const BlockInputSchema = z.object({
  blockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  truckId: z.string().uuid().nullable(),
  reason: z.string().max(200).optional(),
});
export type BlockInput = z.infer<typeof BlockInputSchema>;
```

- [ ] Run it again and confirm it passes:

```
npx vitest run src/features/orders/tests/unit/types.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1


 Test Files  1 passed (1)
      Tests  27 passed (27)
```

- [ ] Typecheck and lint the new file (zod schemas and `Record<Enum, string>` completeness are the main source of type errors here — both must be clean before moving on):

```
npx tsc --noEmit -p tsconfig.json
npx eslint src/features/orders
```

Expected: no output, exit code 0 for both.

- [ ] Commit:

```
git add src/features/orders/types.ts src/features/orders/tests/unit/types.test.ts
git commit -m "feat(orders): add orders feature types and zod schemas"
```

---

### Task 5: Order model lib

**Files:**
Create: `src/features/orders/lib/roles.ts`
Create: `src/features/orders/lib/order-model.ts`
Test: `src/features/orders/tests/unit/order-model.test.ts`

**Interfaces:**
Consumes: `OrderStatus`, `OrderItem`, `OrderFallback`, `FALLBACK_LABELS` from `../types` (Task 4).
Produces (exact — `server/guards.ts`, `server/schedule-actions.ts`, `server/order-actions.ts` consume `MANAGER_ROLES`/`STAFF_ROLES`; server actions and UI clients consume the `order-model.ts` exports for transition guards, settlement math, warnings, and display formatting):
```ts
// lib/roles.ts
export const MANAGER_ROLES: readonly ["owner", "org_admin", "seller"];
export const STAFF_ROLES: readonly ["owner", "org_admin", "seller", "inventory", "logistics"];
export type OrgRole = string;

// lib/order-model.ts
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]>;
export function canTransition(from: OrderStatus, to: OrderStatus): boolean;
export function computeLineTotal(finalWeightKg: number, pricePerKg: number): number;
export function computeOrderTotal(lines: Array<{ final_weight_kg: number | null; price_per_kg: number | null; is_cancelled: boolean }>): number;
export type WeightWarning = { itemId: string; kind: "deviation" | "size_range"; message: string };
export function weightWarnings(item: Pick<OrderItem, "id" | "mode" | "quantity" | "size_min_kg" | "size_max_kg" | "warehouse_weight_kg" | "final_weight_kg" | "final_pieces" | "warehouse_pieces">): WeightWarning[];
export function formatPrice(amount: number): string;
export function formatWeight(kg: number): string;
export function describeFallback(applied: OrderFallback | null): string | null;
```

- [ ] Create `src/features/orders/lib/roles.ts` first (Task 4 is done; `MANAGER_ROLES`/`STAFF_ROLES` have no independent logic to unit test — they are plain constants consumed by `canTransition`-adjacent guard code later, so they get a typecheck/lint pass instead of a dedicated test file, matching the contract's note that no capability-system test is needed here):

```ts
/**
 * Client-safe role lists for the order pipeline. These mirror the role
 * arrays the SQL RPCs enforce with `has_org_role(org, array[...])` — see
 * `server/guards.ts` for the server-side check and the SQL migrations for
 * the RPC-side enforcement.
 */

export const MANAGER_ROLES = ["owner", "org_admin", "seller"] as const;
export const STAFF_ROLES = [...MANAGER_ROLES, "inventory", "logistics"] as const;
export type OrgRole = string;
```

- [ ] Typecheck and lint it (no runtime logic to test yet — `order-model.ts` doesn't exist so a full-suite `npm test` would fail on the next step's missing import; scope typecheck/lint to this one file for now):

```
npx tsc --noEmit -p tsconfig.json
npx eslint src/features/orders/lib/roles.ts
```

Expected: no output, exit code 0 for both.

- [ ] Write the failing test `src/features/orders/tests/unit/order-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canTransition,
  computeLineTotal,
  computeOrderTotal,
  describeFallback,
  formatPrice,
  formatWeight,
  ORDER_TRANSITIONS,
  weightWarnings,
} from "../../lib/order-model";
import type { OrderFallback, OrderItem, OrderStatus } from "../../types";

function orderItem(overrides: Partial<OrderItem>): OrderItem {
  return {
    id: "item-1",
    order_id: "order-1",
    product_id: "product-1",
    mode: "kg",
    quantity: 1,
    size_min_kg: 1.5,
    size_max_kg: 1.7,
    fallback: "mix",
    fallback_applied: null,
    is_cancelled: false,
    warehouse_weight_kg: null,
    warehouse_pieces: null,
    final_weight_kg: null,
    final_pieces: null,
    price_per_kg: null,
    line_total: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

describe("ORDER_TRANSITIONS / canTransition", () => {
  const allStatuses: OrderStatus[] = [
    "pending",
    "confirmed",
    "ready",
    "delivered",
    "closed",
    "cancelled",
  ];

  it("allows every transition declared in ORDER_TRANSITIONS", () => {
    for (const from of allStatuses) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it("rejects closed -> pending", () => {
    expect(canTransition("closed", "pending")).toBe(false);
  });

  it("rejects every transition out of cancelled", () => {
    for (const to of allStatuses) {
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });

  it("rejects pending -> ready (must go through confirmed)", () => {
    expect(canTransition("pending", "ready")).toBe(false);
  });

  it("rejects delivered -> pending", () => {
    expect(canTransition("delivered", "pending")).toBe(false);
  });
});

describe("computeLineTotal", () => {
  it("rounds weight x price to the nearest cent", () => {
    // 1.234 kg x RM9.90 = 12.2166 -> rounds to 12.22
    expect(computeLineTotal(1.234, 9.9)).toBe(12.22);
  });

  it("rounds a second fractional value to the nearest cent", () => {
    // 1.231 kg x RM9.90 = 12.1869 -> rounds to 12.19
    expect(computeLineTotal(1.231, 9.9)).toBe(12.19);
  });

  it("handles a whole-number result", () => {
    expect(computeLineTotal(2, 5)).toBe(10);
  });
});

describe("computeOrderTotal", () => {
  it("skips cancelled lines", () => {
    const total = computeOrderTotal([
      { final_weight_kg: 10, price_per_kg: 9, is_cancelled: false },
      { final_weight_kg: 999, price_per_kg: 999, is_cancelled: true },
    ]);
    expect(total).toBe(90);
  });

  it("skips lines with a null final_weight_kg or price_per_kg", () => {
    const total = computeOrderTotal([
      { final_weight_kg: 10, price_per_kg: 9, is_cancelled: false },
      { final_weight_kg: null, price_per_kg: 9, is_cancelled: false },
      { final_weight_kg: 10, price_per_kg: null, is_cancelled: false },
    ]);
    expect(total).toBe(90);
  });

  it("sums multiple valid lines", () => {
    const total = computeOrderTotal([
      { final_weight_kg: 1.234, price_per_kg: 9.9, is_cancelled: false },
      { final_weight_kg: 2, price_per_kg: 5, is_cancelled: false },
    ]);
    expect(total).toBe(22.22);
  });

  it("returns 0 for an empty list", () => {
    expect(computeOrderTotal([])).toBe(0);
  });
});

describe("weightWarnings — deviation", () => {
  it("does not warn at exactly 20% deviation (boundary)", () => {
    const item = orderItem({
      warehouse_weight_kg: 10,
      final_weight_kg: 12, // 2/10 = exactly 20%
      final_pieces: null,
      warehouse_pieces: null,
      mode: "kg",
      quantity: 1,
      size_min_kg: 0.1,
      size_max_kg: 50,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "deviation")).toBe(false);
  });

  it("warns just above 20% deviation", () => {
    const item = orderItem({
      warehouse_weight_kg: 10,
      final_weight_kg: 12.01, // 2.01/10 = 20.1%
      final_pieces: null,
      warehouse_pieces: null,
      mode: "kg",
      quantity: 1,
      size_min_kg: 0.1,
      size_max_kg: 50,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "deviation")).toBe(true);
  });

  it("does not warn when either warehouse or final weight is missing", () => {
    const item = orderItem({
      warehouse_weight_kg: null,
      final_weight_kg: 12,
      final_pieces: null,
      warehouse_pieces: null,
    });
    expect(weightWarnings(item).some((w) => w.kind === "deviation")).toBe(false);
  });
});

describe("weightWarnings — size_range via final_pieces fallback chain", () => {
  it("uses final_pieces when present", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20, // avg 2.0 kg/bird if using final_pieces=10 -> outside range
      final_pieces: 10,
      warehouse_pieces: 999, // must be ignored in favour of final_pieces
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(true);
  });

  it("falls back to warehouse_pieces when final_pieces is null", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20, // avg 2.0 kg/bird using warehouse_pieces=10 -> outside range
      final_pieces: null,
      warehouse_pieces: 10,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(true);
  });

  it("falls back to quantity when mode is piece and both pieces fields are null", () => {
    const item = orderItem({
      mode: "piece",
      quantity: 10,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20, // avg 2.0 kg/bird using quantity=10 -> outside range
      final_pieces: null,
      warehouse_pieces: null,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(true);
  });

  it("has no pieces fallback for kg mode with no pieces recorded, so no size_range warning", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20,
      final_pieces: null,
      warehouse_pieces: null,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(false);
  });

  it("does not warn when the average is within the size range", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 16, // avg 1.6 kg/bird -> within range
      final_pieces: 10,
      warehouse_pieces: null,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(false);
  });
});

describe("formatPrice", () => {
  it("formats MYR with two decimals", () => {
    // Intl may use a non-breaking space; match flexibly.
    expect(formatPrice(12)).toMatch(/^RM\s?12\.00$/);
    expect(formatPrice(1234.5)).toMatch(/^RM\s?1,234\.50$/);
  });
});

describe("formatWeight", () => {
  it("trims trailing zeros and appends kg", () => {
    expect(formatWeight(1.5)).toBe("1.5 kg");
    expect(formatWeight(2)).toBe("2 kg");
    expect(formatWeight(1.234)).toBe("1.234 kg");
  });

  it("rounds to 3 decimal places", () => {
    expect(formatWeight(1.23456)).toBe("1.235 kg");
  });
});

describe("describeFallback", () => {
  it("returns null when no fallback was applied", () => {
    expect(describeFallback(null)).toBe(null);
  });

  it("returns the friendly label for an applied fallback", () => {
    const applied: OrderFallback = "downsize";
    expect(describeFallback(applied)).toBe("Smaller is ok");
  });
});
```

- [ ] Run it and confirm it fails because `src/features/orders/lib/order-model.ts` does not exist yet:

```
npx vitest run src/features/orders/tests/unit/order-model.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1

 ❯ src/features/orders/tests/unit/order-model.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/features/orders/tests/unit/order-model.test.ts [ src/features/orders/tests/unit/order-model.test.ts ]
Error: Cannot find module '../../lib/order-model' imported from /Users/alob/AyamNorliza-1/src/features/orders/tests/unit/order-model.test.ts
 ❯ src/features/orders/tests/unit/order-model.test.ts:2:1
      1| import { describe, expect, it } from "vitest";
      2| import {
       | ^
      3|   canTransition,
      4|   computeLineTotal,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] Create `src/features/orders/lib/order-model.ts` with the full implementation:

```ts
/**
 * Pure order-pipeline model: status transitions, settlement math, weight
 * sanity warnings, and display formatters. No I/O — safe to unit test
 * without mocking Supabase.
 */

import type { OrderFallback, OrderItem, OrderStatus } from "../types";
import { FALLBACK_LABELS } from "../types";

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: ["closed", "cancelled"],
  closed: ["delivered"],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Settlement math
// ---------------------------------------------------------------------------

export function computeLineTotal(finalWeightKg: number, pricePerKg: number): number {
  return Math.round(finalWeightKg * pricePerKg * 100) / 100;
}

export function computeOrderTotal(
  lines: Array<{
    final_weight_kg: number | null;
    price_per_kg: number | null;
    is_cancelled: boolean;
  }>,
): number {
  const total = lines.reduce((sum, line) => {
    if (line.is_cancelled) return sum;
    if (line.final_weight_kg === null || line.price_per_kg === null) return sum;
    return sum + computeLineTotal(line.final_weight_kg, line.price_per_kg);
  }, 0);
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// Weight sanity warnings
// ---------------------------------------------------------------------------

export type WeightWarning = { itemId: string; kind: "deviation" | "size_range"; message: string };

export function weightWarnings(
  item: Pick<
    OrderItem,
    | "id"
    | "mode"
    | "quantity"
    | "size_min_kg"
    | "size_max_kg"
    | "warehouse_weight_kg"
    | "final_weight_kg"
    | "final_pieces"
    | "warehouse_pieces"
  >,
): WeightWarning[] {
  const warnings: WeightWarning[] = [];

  if (item.warehouse_weight_kg !== null && item.final_weight_kg !== null) {
    const deviation =
      Math.abs(item.final_weight_kg - item.warehouse_weight_kg) / item.warehouse_weight_kg;
    if (deviation > 0.2) {
      warnings.push({
        itemId: item.id,
        kind: "deviation",
        message: `Final weight deviates ${(deviation * 100).toFixed(0)}% from the warehouse weight`,
      });
    }
  }

  const pieces =
    item.final_pieces ?? item.warehouse_pieces ?? (item.mode === "piece" ? item.quantity : null);
  if (pieces && item.final_weight_kg !== null) {
    const avgKg = item.final_weight_kg / pieces;
    if (avgKg < item.size_min_kg || avgKg > item.size_max_kg) {
      warnings.push({
        itemId: item.id,
        kind: "size_range",
        message: `Average bird weight ${avgKg.toFixed(2)} kg is outside the ordered size range (${item.size_min_kg}–${item.size_max_kg} kg)`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const myr = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export function formatPrice(amount: number): string {
  return myr.format(amount);
}

export function formatWeight(kg: number): string {
  return `${Number(kg.toFixed(3))} kg`;
}

export function describeFallback(applied: OrderFallback | null): string | null {
  if (applied === null) return null;
  return FALLBACK_LABELS[applied];
}
```

- [ ] Run it again and confirm it passes:

```
npx vitest run src/features/orders/tests/unit/order-model.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1


 Test Files  1 passed (1)
      Tests  25 passed (25)
```

- [ ] Typecheck and lint both new files:

```
npx tsc --noEmit -p tsconfig.json
npx eslint src/features/orders
```

Expected: no output, exit code 0 for both.

- [ ] Run the full orders unit suite together as a final check before committing:

```
npx vitest run src/features/orders/tests/unit/types.test.ts src/features/orders/tests/unit/order-model.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1


 Test Files  2 passed (2)
      Tests  52 passed (52)
```

- [ ] Commit:

```
git add src/features/orders/lib/roles.ts src/features/orders/lib/order-model.ts src/features/orders/tests/unit/order-model.test.ts
git commit -m "feat(orders): add order-model pure lib (transitions, settlement math, warnings, formatters)"
```
### Task 6: Guards + schedule admin actions

**Files:**
Create: `src/features/orders/server/guards.ts`, `src/features/orders/server/schedule-actions.ts`, `src/features/orders/tests/unit/schedule-actions.test.ts`

**Interfaces:**
Consumes: `createSupabaseServerClient(): Promise<SupabaseClient>` from `@/lib/supabase/server`; `MANAGER_ROLES = ["owner","org_admin","seller"] as const` from `../lib/roles`; from `../types`: `ActionResult<T>`, `DeliveryZone`, `Truck`, `TruckZone`, `DeliverySlot`, `ScheduleBlock`, `DeliverySetup`, `ZoneInputSchema`, `TruckInputSchema`, `SlotInputSchema`, `BlockInputSchema`.
Produces:
- `./guards`: `export class OrderPermissionError extends Error { readonly code = "forbidden" }`; `export async function requireOrgRole(organizationSlug: string, roles: readonly string[]): Promise<{ orgId: string; userId: string; role: string }>`; `export async function requireRoleOrRedirect(organizationSlug: string, roles: readonly string[]): Promise<{ orgId: string; userId: string; role: string }>`.
- `./schedule-actions`: `getDeliverySetup(organizationSlug: string): Promise<ActionResult<DeliverySetup>>`, `createZone(organizationSlug: string, rawInput: unknown): Promise<ActionResult<DeliveryZone>>`, `updateZone(organizationSlug: string, zoneId: string, rawInput: unknown): Promise<ActionResult<DeliveryZone>>`, `deleteZone(organizationSlug: string, zoneId: string): Promise<ActionResult>`, `createTruck(organizationSlug: string, rawInput: unknown): Promise<ActionResult<Truck>>`, `updateTruck(organizationSlug: string, truckId: string, rawInput: unknown): Promise<ActionResult<Truck>>`, `deleteTruck(organizationSlug: string, truckId: string): Promise<ActionResult>`, `setTruckZones(organizationSlug: string, truckId: string, zoneIds: string[]): Promise<ActionResult>`, `createSlot(organizationSlug: string, rawInput: unknown): Promise<ActionResult<DeliverySlot>>`, `updateSlot(organizationSlug: string, slotId: string, rawInput: unknown): Promise<ActionResult<DeliverySlot>>`, `deleteSlot(organizationSlug: string, slotId: string): Promise<ActionResult>`, `createBlock(organizationSlug: string, rawInput: unknown): Promise<ActionResult<ScheduleBlock>>`, `deleteBlock(organizationSlug: string, blockId: string): Promise<ActionResult>`. These are consumed later by the seller `delivery/page.tsx` + `delivery-client.tsx` task (outside this section).

---

- [ ] Step 1: Write the failing test file for guards + schedule admin actions

Create `src/features/orders/tests/unit/schedule-actions.test.ts`:

```ts
/**
 * Unit tests for schedule-admin Server Actions. The Supabase server client
 * is mocked so no database is required; `requireOrgRole` (in ./guards) is
 * exercised indirectly through the actions since it has no dedicated test
 * file of its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createZone, deleteZone } from "../../server/schedule-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A minimal chainable Supabase query-builder stub. Every builder method
 * (select/insert/update/delete/eq/...) returns the same object so calls
 * can be chained in any order; `.single()`/`.maybeSingle()` resolve the
 * configured result, and the object is itself thenable so code that
 * `await`s the builder directly (no terminal call, e.g. a bare `.delete()`)
 * also resolves the configured result.
 */
function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "or", "order", "is", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * Builds a mock Supabase client. `from("organizations")` and
 * `from("organization_members")` are wired to satisfy `requireOrgRole`;
 * any other table name is served from `tableResults`, falling back to
 * `{ data: null, error: null }`.
 */
function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  role = "owner",
  tableResults = {} as Record<string, QueryResult>,
}: {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  tableResults?: Record<string, QueryResult>;
}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return chain({ data: orgId ? { id: orgId } : null, error: null });
      }
      if (table === "organization_members") {
        return chain({ data: role ? { role } : null, error: null });
      }
      if (tableResults[table]) {
        return chain(tableResults[table]);
      }
      return chain({ data: null, error: null });
    }),
    rpc: vi.fn(),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createZone", () => {
  it("returns forbidden for a non-manager role", async () => {
    mockSupabaseFor({ role: "caretaker" });

    const result = await createZone("ayam-norliza-pilot", { name: "Zone 1" });

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });

  it("rejects invalid input with a validation error", async () => {
    mockSupabaseFor({ role: "owner" });

    const result = await createZone("ayam-norliza-pilot", { name: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
    }
  });

  it("creates a zone on valid input", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        delivery_zones: {
          data: {
            id: "zone-1",
            organization_id: "org-1",
            name: "Zone 1",
            display_order: 0,
            is_active: true,
            created_by: "user-1",
            created_at: "2026-08-10T00:00:00Z",
            updated_at: "2026-08-10T00:00:00Z",
            version: 1,
          },
          error: null,
        },
      },
    });

    const result = await createZone("ayam-norliza-pilot", { name: "Zone 1" });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "zone-1", name: "Zone 1" }),
    });
  });
});

describe("deleteZone", () => {
  it("maps a foreign-key violation to a friendly message", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        delivery_zones: {
          data: null,
          error: { code: "23503", message: "update or delete on table violates foreign key constraint" },
        },
      },
    });

    const result = await deleteZone("ayam-norliza-pilot", "zone-1");

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "This zone has orders using it. Remove or reassign those first.",
    });
  });
});
```

- [ ] Step 2: Run the test, confirm it fails because the source files don't exist yet

```
npx vitest run src/features/orders/tests/unit/schedule-actions.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1

 ❯ src/features/orders/tests/unit/schedule-actions.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/features/orders/tests/unit/schedule-actions.test.ts [ src/features/orders/tests/unit/schedule-actions.test.ts ]
Error: Cannot find module '../../server/schedule-actions' imported from /Users/alob/AyamNorliza-1/src/features/orders/tests/unit/schedule-actions.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] Step 3: Create `src/features/orders/server/guards.ts`

```ts
/**
 * Org-role guard for the order-pipeline Server Actions.
 *
 * Every action in schedule-actions.ts and order-actions.ts calls
 * `requireOrgRole` before touching Supabase. Server Components that need
 * to redirect instead of receiving a typed error use
 * `requireRoleOrRedirect` (mirrors `requireBuyerOrRedirect` in
 * @/lib/auth/buyer-auth).
 */

import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class OrderPermissionError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have access to this feature") {
    super(message);
    this.name = "OrderPermissionError";
  }
}

export type OrgRoleContext = { orgId: string; userId: string; role: string };

export async function requireOrgRole(
  organizationSlug: string,
  roles: readonly string[],
): Promise<OrgRoleContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new OrderPermissionError("Not authenticated");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    throw new OrderPermissionError("Organization not found");
  }

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!member || !roles.includes(member.role)) {
    throw new OrderPermissionError();
  }

  return { orgId: org.id, userId: user.id, role: member.role };
}

/**
 * For Server Components that cannot redirect from inside try/catch.
 */
export async function requireRoleOrRedirect(
  organizationSlug: string,
  roles: readonly string[],
): Promise<OrgRoleContext> {
  try {
    return await requireOrgRole(organizationSlug, roles);
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}`);
    }
    throw e;
  }
}
```

- [ ] Step 4: Create `src/features/orders/server/schedule-actions.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "./guards";
import { MANAGER_ROLES } from "../lib/roles";
import {
  ZoneInputSchema,
  TruckInputSchema,
  SlotInputSchema,
  BlockInputSchema,
  type ActionResult,
  type DeliveryZone,
  type Truck,
  type DeliverySlot,
  type ScheduleBlock,
  type DeliverySetup,
} from "../types";

type ScheduleErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(
  code: ScheduleErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function guardManager(
  organizationSlug: string,
): Promise<
  | { ok: true; orgId: string; userId: string }
  | { ok: false; code: "forbidden"; message: string }
> {
  try {
    const ctx = await requireOrgRole(organizationSlug, MANAGER_ROLES);
    return { ok: true, orgId: ctx.orgId, userId: ctx.userId };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, code: "forbidden", message: e.message };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Delivery setup (read)
// ---------------------------------------------------------------------------

export async function getDeliverySetup(
  organizationSlug: string,
): Promise<ActionResult<DeliverySetup>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();

  const [zones, trucks, truckZones, slots, blocks] = await Promise.all([
    supabase
      .from("delivery_zones")
      .select("*")
      .eq("organization_id", orgId)
      .order("display_order", { ascending: true }),
    supabase.from("trucks").select("*").eq("organization_id", orgId).order("name", { ascending: true }),
    supabase.from("truck_zones").select("*").eq("organization_id", orgId),
    supabase
      .from("delivery_slots")
      .select("*")
      .eq("organization_id", orgId)
      .order("weekday", { ascending: true }),
    supabase
      .from("schedule_blocks")
      .select("*")
      .eq("organization_id", orgId)
      .order("block_date", { ascending: true }),
  ]);

  if (zones.error || trucks.error || truckZones.error || slots.error || blocks.error) {
    return err("internal", "Failed to load delivery setup");
  }

  return ok({
    zones: (zones.data ?? []) as DeliverySetup["zones"],
    trucks: (trucks.data ?? []) as DeliverySetup["trucks"],
    truckZones: (truckZones.data ?? []) as DeliverySetup["truckZones"],
    slots: (slots.data ?? []) as DeliverySetup["slots"],
    blocks: (blocks.data ?? []) as DeliverySetup["blocks"],
  });
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export async function createZone(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<DeliveryZone>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = ZoneInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid zone input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_zones")
    .insert({
      organization_id: orgId,
      name: input.name,
      display_order: input.displayOrder,
      is_active: input.isActive,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to create zone");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliveryZone);
}

export async function updateZone(
  organizationSlug: string,
  zoneId: string,
  rawInput: unknown,
): Promise<ActionResult<DeliveryZone>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = ZoneInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid zone input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_zones")
    .update({
      name: input.name,
      display_order: input.displayOrder,
      is_active: input.isActive,
    })
    .eq("id", zoneId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to update zone");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliveryZone);
}

export async function deleteZone(
  organizationSlug: string,
  zoneId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("delivery_zones")
    .delete()
    .eq("id", zoneId)
    .eq("organization_id", orgId);

  if (error) {
    if (error.code === "23503") {
      return err("conflict", "This zone has orders using it. Remove or reassign those first.");
    }
    return err("internal", error.message);
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Trucks
// ---------------------------------------------------------------------------

export async function createTruck(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<Truck>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = TruckInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid truck input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trucks")
    .insert({
      organization_id: orgId,
      name: input.name,
      code: input.code,
      is_active: input.isActive,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return err("conflict", "That truck code is already in use.");
    }
    return err("internal", error?.message ?? "Failed to create truck");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Truck);
}

export async function updateTruck(
  organizationSlug: string,
  truckId: string,
  rawInput: unknown,
): Promise<ActionResult<Truck>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = TruckInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid truck input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trucks")
    .update({
      name: input.name,
      code: input.code,
      is_active: input.isActive,
    })
    .eq("id", truckId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return err("conflict", "That truck code is already in use.");
    }
    return err("internal", error?.message ?? "Failed to update truck");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Truck);
}

export async function deleteTruck(
  organizationSlug: string,
  truckId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trucks")
    .delete()
    .eq("id", truckId)
    .eq("organization_id", orgId);

  if (error) {
    if (error.code === "23503") {
      return err("conflict", "This truck has delivery runs or orders attached. Remove those first.");
    }
    return err("internal", error.message);
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

export async function setTruckZones(
  organizationSlug: string,
  truckId: string,
  zoneIds: string[],
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = z.array(z.string().uuid()).safeParse(zoneIds);
  if (!parsed.success) {
    return err("validation", "Invalid zone selection");
  }

  const supabase = await createSupabaseServerClient();
  const { error: deleteError } = await supabase
    .from("truck_zones")
    .delete()
    .eq("truck_id", truckId)
    .eq("organization_id", orgId);
  if (deleteError) {
    return err("internal", deleteError.message);
  }

  if (parsed.data.length > 0) {
    const { error: insertError } = await supabase.from("truck_zones").insert(
      parsed.data.map((zoneId) => ({
        truck_id: truckId,
        zone_id: zoneId,
        organization_id: orgId,
      })),
    );
    if (insertError) {
      return err("internal", insertError.message);
    }
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export async function createSlot(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<DeliverySlot>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = SlotInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid slot input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_slots")
    .insert({
      organization_id: orgId,
      truck_id: input.truckId,
      weekday: input.weekday,
      start_time: input.startTime,
      end_time: input.endTime,
      max_orders: input.maxOrders,
      is_active: input.isActive,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to create slot");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliverySlot);
}

export async function updateSlot(
  organizationSlug: string,
  slotId: string,
  rawInput: unknown,
): Promise<ActionResult<DeliverySlot>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = SlotInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid slot input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_slots")
    .update({
      truck_id: input.truckId,
      weekday: input.weekday,
      start_time: input.startTime,
      end_time: input.endTime,
      max_orders: input.maxOrders,
      is_active: input.isActive,
    })
    .eq("id", slotId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to update slot");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliverySlot);
}

export async function deleteSlot(
  organizationSlug: string,
  slotId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("delivery_slots")
    .delete()
    .eq("id", slotId)
    .eq("organization_id", orgId);

  if (error) {
    if (error.code === "23503") {
      return err("conflict", "This slot has orders booked against it. Remove those first.");
    }
    return err("internal", error.message);
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Blocked dates
// ---------------------------------------------------------------------------

export async function createBlock(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<ScheduleBlock>> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = BlockInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid block input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("schedule_blocks")
    .insert({
      organization_id: orgId,
      block_date: input.blockDate,
      truck_id: input.truckId,
      reason: input.reason ?? null,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return err("conflict", "That date is already blocked for this truck.");
    }
    return err("internal", error?.message ?? "Failed to create block");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as ScheduleBlock);
}

export async function deleteBlock(
  organizationSlug: string,
  blockId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("schedule_blocks")
    .delete()
    .eq("id", blockId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", error.message);
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}
```

- [ ] Step 5: Run the test again, confirm it passes

```
npx vitest run src/features/orders/tests/unit/schedule-actions.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  22:04:10
   Duration  140ms (transform 20ms, setup 16ms, import 22ms, tests 6ms, environment 0ms)
```

- [ ] Step 6: Typecheck and lint

```
npm run typecheck
npm run lint
```
Expected: both exit 0 with no errors reported.

- [ ] Step 7: Commit

```
git add src/features/orders/server/guards.ts src/features/orders/server/schedule-actions.ts src/features/orders/tests/unit/schedule-actions.test.ts
git commit -m "feat(orders): add org-role guard and schedule admin actions"
```

---

### Task 7: Portal actions

**Files:**
Create: `src/features/orders/server/portal-actions.ts`, `src/features/orders/tests/unit/portal-actions.test.ts`

**Interfaces:**
Consumes: `requireBuyer(): Promise<Buyer>` and `export class NotABuyerError extends Error { readonly code = "not_a_buyer" }` from `@/lib/auth/buyer-auth`; `createSupabaseServerClient()` from `@/lib/supabase/server`; from `../types`: `ActionResult<T>`, `PlaceOrderSchema` (fields `organizationSlug`, `zoneId`, `slotId`, `deliveryDate`, `address`, `notes?`, `items`, `customerId?`), `DeliveryZone`, `DeliveryOption`, `OrderListItem`, `OrderWithItems`.
Produces (from `./portal-actions`, consumed by the buyer-portal route tasks outside this section): `getActiveZones(organizationSlug: string): Promise<ActionResult<DeliveryZone[]>>`, `getDeliveryOptions(organizationSlug: string, zoneId: string): Promise<ActionResult<DeliveryOption[]>>`, `placeOrder(rawInput: unknown): Promise<ActionResult<{ orderId: string }>>`, `getMyOrders(): Promise<ActionResult<OrderListItem[]>>`, `getMyOrder(orderId: string): Promise<ActionResult<OrderWithItems>>`, `cancelMyOrder(orderId: string, reason?: string): Promise<ActionResult>`.

---

- [ ] Step 1: Write the failing test file

Create `src/features/orders/tests/unit/portal-actions.test.ts`:

```ts
/**
 * Unit tests for buyer-portal Server Actions. Both the Supabase server
 * client and the buyer-auth guard are mocked so no database/session is
 * required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/auth/buyer-auth", () => ({
  requireBuyer: vi.fn(),
  NotABuyerError: class NotABuyerError extends Error {
    readonly code = "not_a_buyer";
  },
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import { placeOrder, cancelMyOrder } from "../../server/portal-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "or", "order", "is", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabase({
  orgId = "org-1",
  rpcResult = { data: null, error: null } as { data: unknown; error: { message: string } | null },
}: {
  orgId?: string | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
} = {}) {
  const supabase = {
    from: vi.fn(() => chain({ data: orgId ? { id: orgId } : null, error: null })),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const testBuyer = {
  id: "buyer-1",
  organization_id: "org-1",
  display_name: "Test Buyer",
  address: null,
  phone: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

const validPlaceOrderInput = {
  organizationSlug: "ayam-norliza-pilot",
  zoneId: "11111111-1111-1111-1111-111111111111",
  slotId: "22222222-2222-2222-2222-222222222222",
  deliveryDate: "2026-08-15",
  address: "123 Jalan Ayam",
  items: [
    {
      productId: "33333333-3333-3333-3333-333333333333",
      mode: "kg" as const,
      quantity: 2,
      sizeMinKg: 1.5,
      sizeMaxKg: 1.7,
      fallback: "mix" as const,
    },
  ],
};

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(requireBuyer).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("placeOrder", () => {
  it("places an order and returns the new order id", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: "order-1", error: null } });

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({ ok: true, data: { orderId: "order-1" } });
  });

  it("maps slot_full to a friendly conflict message", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "slot_full" } } });

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "That delivery slot just filled up — pick another.",
    });
  });

  it("returns unauthenticated when the caller is not a buyer", async () => {
    vi.mocked(requireBuyer).mockRejectedValue(new NotABuyerError("Not registered as a buyer"));

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "Not registered as a buyer",
    });
  });
});

describe("cancelMyOrder", () => {
  it("maps invalid_status to a friendly conflict message", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "invalid_status" } } });

    const result = await cancelMyOrder("order-1", "Changed my mind");

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "This order can no longer be cancelled.",
    });
  });
});
```

- [ ] Step 2: Run the test, confirm it fails

```
npx vitest run src/features/orders/tests/unit/portal-actions.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1

 ❯ src/features/orders/tests/unit/portal-actions.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/features/orders/tests/unit/portal-actions.test.ts [ src/features/orders/tests/unit/portal-actions.test.ts ]
Error: Cannot find module '../../server/portal-actions' imported from /Users/alob/AyamNorliza-1/src/features/orders/tests/unit/portal-actions.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] Step 3: Create `src/features/orders/server/portal-actions.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import {
  PlaceOrderSchema,
  type ActionResult,
  type DeliveryZone,
  type DeliveryOption,
  type OrderListItem,
  type OrderWithItems,
} from "../types";

type PortalErrorCode = "validation" | "unauthenticated" | "not_found" | "conflict" | "internal" | "forbidden";

function err<T = never>(
  code: PortalErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * Maps the machine-readable codes raised by the RPCs this file calls
 * (place_order, cancel_order) to friendly messages. order-actions.ts owns
 * the canonical mapRpcError covering every RPC's codes; see the CONTRACT
 * CONCERN note at the end of this plan for why this is a separate, smaller
 * copy rather than an import from order-actions.ts.
 */
function mapPortalRpcError(message: string): { code: PortalErrorCode; message: string } {
  switch (message) {
    case "zone_not_found":
      return { code: "not_found", message: "That delivery zone was not found." };
    case "slot_not_found":
      return { code: "not_found", message: "That delivery slot is no longer available." };
    case "date_out_of_window":
      return { code: "validation", message: "Pick a delivery date within the next 14 days." };
    case "weekday_mismatch":
      return { code: "validation", message: "That date does not match the slot's day of the week." };
    case "date_blocked":
      return { code: "conflict", message: "Deliveries are blocked on that date. Pick another." };
    case "slot_full":
      return { code: "conflict", message: "That delivery slot just filled up — pick another." };
    case "invalid_items":
      return { code: "validation", message: "One or more items in your order are invalid." };
    case "invalid_status":
      return { code: "conflict", message: "This order can no longer be cancelled." };
    case "forbidden":
      return { code: "forbidden", message: "You cannot cancel this order." };
    default:
      return { code: "internal", message: "Something went wrong. Please try again." };
  }
}

export async function getActiveZones(
  organizationSlug: string,
): Promise<ActionResult<DeliveryZone[]>> {
  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    return err("not_found", "Organization not found");
  }

  const { data, error } = await supabase
    .from("delivery_zones")
    .select("*")
    .eq("organization_id", org.id)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    return err("internal", "Failed to load delivery zones");
  }

  return ok((data ?? []) as DeliveryZone[]);
}

export async function getDeliveryOptions(
  organizationSlug: string,
  zoneId: string,
): Promise<ActionResult<DeliveryOption[]>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    return err("not_found", "Organization not found");
  }

  const { data, error } = await supabase.rpc("get_delivery_options", {
    p_org: org.id,
    p_zone: zoneId,
  });

  if (error) {
    return err("internal", "Failed to load delivery options");
  }

  const options = (data ?? []) as Array<{
    option_date: string;
    slot_id: string;
    truck_id: string;
    truck_name: string;
    start_time: string;
    end_time: string;
    remaining: number | null;
  }>;

  return ok(
    options.map((row) => ({
      date: row.option_date,
      slotId: row.slot_id,
      truckId: row.truck_id,
      truckName: row.truck_name,
      startTime: row.start_time,
      endTime: row.end_time,
      remaining: row.remaining,
    })),
  );
}

export async function placeOrder(
  rawInput: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const parsed = PlaceOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid order input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  if (input.customerId) {
    return err("validation", "customerId is not allowed for portal orders");
  }

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", input.organizationSlug)
    .single();
  if (!org) {
    return err("not_found", "Organization not found");
  }

  const { data, error } = await supabase.rpc("place_order", {
    p_org: org.id,
    p_zone: input.zoneId,
    p_slot: input.slotId,
    p_date: input.deliveryDate,
    p_address: input.address,
    p_notes: input.notes ?? null,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      mode: item.mode,
      quantity: item.quantity,
      size_min_kg: item.sizeMinKg,
      size_max_kg: item.sizeMaxKg,
      fallback: item.fallback,
    })),
  });

  if (error) {
    const mapped = mapPortalRpcError(error.message);
    return err(mapped.code, mapped.message);
  }

  revalidatePath(`/buyer_portal/${input.organizationSlug}/orders`);
  return ok({ orderId: data as string });
}

export async function getMyOrders(): Promise<ActionResult<OrderListItem[]>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, customer:customers(name), zone:delivery_zones(name)")
    .order("created_at", { ascending: false });

  if (error) {
    return err("internal", "Failed to load your orders");
  }

  return ok((data ?? []) as OrderListItem[]);
}

export async function getMyOrder(orderId: string): Promise<ActionResult<OrderWithItems>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      truck:trucks(*),
      customer:customers(id, name, phone)
    `,
    )
    .eq("id", orderId)
    .single();

  if (error || !order) {
    return err("not_found", "Order not found");
  }

  const { data: items } = await supabase
    .from("order_items")
    .select("*, product:products(id, name, image_url)")
    .eq("order_id", orderId);

  return ok({
    ...(order as OrderWithItems),
    items: (items ?? []) as OrderWithItems["items"],
  });
}

export async function cancelMyOrder(orderId: string, reason?: string): Promise<ActionResult> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_order", {
    p_order: orderId,
    p_reason: reason ?? null,
  });

  if (error) {
    const mapped = mapPortalRpcError(error.message);
    return err(mapped.code, mapped.message);
  }

  return ok(undefined);
}
```

- [ ] Step 4: Run the test again, confirm it passes

```
npx vitest run src/features/orders/tests/unit/portal-actions.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  22:11:02
   Duration  128ms (transform 18ms, setup 15ms, import 20ms, tests 5ms, environment 0ms)
```

- [ ] Step 5: Typecheck and lint

```
npm run typecheck
npm run lint
```
Expected: both exit 0 with no errors reported.

- [ ] Step 6: Commit

```
git add src/features/orders/server/portal-actions.ts src/features/orders/tests/unit/portal-actions.test.ts
git commit -m "feat(portal): add buyer-facing order Server Actions"
```

---

### Task 8: Manager/staff order actions

**Files:**
Create: `src/features/orders/server/order-actions.ts`, `src/features/orders/tests/unit/order-actions.test.ts`

**Interfaces:**
Consumes: `requireOrgRole`, `OrderPermissionError` from `./guards`; `MANAGER_ROLES`, `STAFF_ROLES` from `../lib/roles`; from `../types`: `ActionResult<T>`, `OrderStatus`, `RunStatus`, `PlaceOrderSchema`, `ConfirmOrderSchema`, `CompleteTaskSchema`, `CloseOrderSchema`, `OrderListItem`, `OrderWithItems`, `TaskWithOrder`, `RunWithOrders`, `DeliveryRun`, `Truck`, `DeliveryOption`.
Produces (from `./order-actions`, consumed by the seller `orders/*`, `runs/*`, `tasks/*` route tasks outside this section): `getOrders(organizationSlug: string, status?: OrderStatus): Promise<ActionResult<OrderListItem[]>>`, `getOrderDetail(organizationSlug: string, orderId: string): Promise<ActionResult<OrderWithItems>>`, `createManualOrder(rawInput: unknown): Promise<ActionResult<{ orderId: string }>>`, `confirmOrder(rawInput: unknown): Promise<ActionResult>`, `cancelOrder(organizationSlug: string, orderId: string, reason: string): Promise<ActionResult>`, `getTodayTasks(organizationSlug: string): Promise<ActionResult<TaskWithOrder[]>>`, `completeTask(rawInput: unknown): Promise<ActionResult>`, `getRuns(organizationSlug: string, date: string): Promise<ActionResult<RunWithOrders[]>>`, `setRunStatus(organizationSlug: string, runId: string, status: RunStatus): Promise<ActionResult>`, `getSettlementQueue(organizationSlug: string): Promise<ActionResult<OrderWithItems[]>>`, `closeOrder(rawInput: unknown): Promise<ActionResult<{ total: number }>>`, `reopenOrder(organizationSlug: string, orderId: string, reason: string): Promise<ActionResult>`, `getDeliveryOptionsForOrg(organizationSlug: string, zoneId: string): Promise<ActionResult<DeliveryOption[]>>`, `getRunManifest(organizationSlug: string, runId: string): Promise<ActionResult<RunWithOrders>>`, `mapRpcError(message: string): { code: string; message: string }`.

---

- [ ] Step 1: Write the failing test file

Create `src/features/orders/tests/unit/order-actions.test.ts`:

```ts
/**
 * Unit tests for manager/staff order Server Actions. The Supabase server
 * client is mocked; `requireOrgRole` (in ./guards) is exercised indirectly
 * through the actions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayTasks, confirmOrder, closeOrder, mapRpcError } from "../../server/order-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "or", "order", "is", "lte", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  role = "owner",
  tableResults = {} as Record<string, QueryResult>,
  rpcResult = { data: null, error: null } as { data: unknown; error: { message: string } | null },
}: {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  tableResults?: Record<string, QueryResult>;
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return chain({ data: orgId ? { id: orgId } : null, error: null });
      }
      if (table === "organization_members") {
        return chain({ data: role ? { role } : null, error: null });
      }
      if (tableResults[table]) {
        return chain(tableResults[table]);
      }
      return chain({ data: null, error: null });
    }),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const ORDER_ID = "44444444-4444-4444-4444-444444444444";
const ITEM_ID = "55555555-5555-5555-5555-555555555555";

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getTodayTasks", () => {
  it("allows a staff role (logistics)", async () => {
    mockSupabaseFor({
      role: "logistics",
      tableResults: { order_tasks: { data: [], error: null } },
    });

    const result = await getTodayTasks("ayam-norliza-pilot");

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("forbids the support role", async () => {
    mockSupabaseFor({ role: "support" });

    const result = await getTodayTasks("ayam-norliza-pilot");

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });
});

describe("confirmOrder", () => {
  it("passes decisions through to the confirm_order rpc", async () => {
    const supabase = mockSupabaseFor({ role: "owner", rpcResult: { data: null, error: null } });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      decisions: [{ itemId: ITEM_ID, available: true }],
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(supabase.rpc).toHaveBeenCalledWith("confirm_order", {
      p_order: ORDER_ID,
      p_decisions: [{ item_id: ITEM_ID, available: true }],
    });
  });
});

describe("closeOrder", () => {
  it("returns the settlement total from the rpc", async () => {
    mockSupabaseFor({ role: "owner", rpcResult: { data: 245.5, error: null } });

    const result = await closeOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      lines: [{ itemId: ITEM_ID, finalWeightKg: 14.5, pricePerKg: 16.5 }],
    });

    expect(result).toEqual({ ok: true, data: { total: 245.5 } });
  });
});

describe("mapRpcError", () => {
  const cases: Array<[string, string]> = [
    ["slot_full", "conflict"],
    ["date_blocked", "conflict"],
    ["invalid_status", "conflict"],
    ["forbidden", "forbidden"],
    ["decisions_incomplete", "validation"],
    ["weights_incomplete", "validation"],
    ["lines_incomplete", "validation"],
    ["task_done", "conflict"],
    ["invalid_items", "validation"],
    ["zone_not_found", "not_found"],
    ["slot_not_found", "not_found"],
    ["date_out_of_window", "validation"],
    ["weekday_mismatch", "validation"],
    ["invalid_weight", "validation"],
    ["invalid_price", "validation"],
    ["invalid_transition", "conflict"],
    ["some_unrecognized_code", "internal"],
  ];

  it.each(cases)("maps %s to code %s", (message, expectedCode) => {
    const result = mapRpcError(message);
    expect(result.code).toBe(expectedCode);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
```

- [ ] Step 2: Run the test, confirm it fails

```
npx vitest run src/features/orders/tests/unit/order-actions.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1

 ❯ src/features/orders/tests/unit/order-actions.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/features/orders/tests/unit/order-actions.test.ts [ src/features/orders/tests/unit/order-actions.test.ts ]
Error: Cannot find module '../../server/order-actions' imported from /Users/alob/AyamNorliza-1/src/features/orders/tests/unit/order-actions.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] Step 3: Create `src/features/orders/server/order-actions.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "./guards";
import { MANAGER_ROLES, STAFF_ROLES } from "../lib/roles";
import {
  PlaceOrderSchema,
  ConfirmOrderSchema,
  CompleteTaskSchema,
  CloseOrderSchema,
  type ActionResult,
  type OrderStatus,
  type RunStatus,
  type OrderListItem,
  type OrderWithItems,
  type TaskWithOrder,
  type RunWithOrders,
  type DeliveryRun,
  type Truck,
  type DeliveryOption,
} from "../types";

type OrderErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(
  code: OrderErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function guardRoles(
  organizationSlug: string,
  roles: readonly string[],
): Promise<
  | { ok: true; orgId: string; userId: string; role: string }
  | { ok: false; code: "forbidden"; message: string }
> {
  try {
    const ctx = await requireOrgRole(organizationSlug, roles);
    return { ok: true, ...ctx };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, code: "forbidden", message: e.message };
    }
    throw e;
  }
}

/**
 * Translates the machine-readable `errcode = 'P0001'` messages raised by
 * the order-pipeline RPCs (place_order, confirm_order, complete_order_task,
 * set_run_status, close_order, cancel_order, reopen_order) into a friendly
 * ActionResult-shaped error. Exported so portal-actions.ts's RPCs share the
 * same wording where their codes overlap (see the CONTRACT CONCERN note at
 * the end of this plan).
 */
export function mapRpcError(message: string): { code: string; message: string } {
  switch (message) {
    case "zone_not_found":
      return { code: "not_found", message: "That delivery zone was not found." };
    case "slot_not_found":
      return { code: "not_found", message: "That delivery slot is no longer available." };
    case "date_out_of_window":
      return { code: "validation", message: "Pick a delivery date within the next 14 days." };
    case "weekday_mismatch":
      return { code: "validation", message: "That date does not match the slot's day of the week." };
    case "date_blocked":
      return { code: "conflict", message: "Deliveries are blocked on that date. Pick another." };
    case "slot_full":
      return { code: "conflict", message: "That delivery slot just filled up — pick another." };
    case "invalid_items":
      return { code: "validation", message: "One or more items in this order are invalid." };
    case "invalid_status":
      return { code: "conflict", message: "This order is not in the right status for that action." };
    case "forbidden":
      return { code: "forbidden", message: "You do not have permission to do that." };
    case "decisions_incomplete":
      return { code: "validation", message: "Every line needs a stock decision before you can confirm." };
    case "weights_incomplete":
      return {
        code: "validation",
        message: "Every line needs a warehouse weight before you can finish this task.",
      };
    case "lines_incomplete":
      return {
        code: "validation",
        message: "Every line needs a final weight and price before you can close this order.",
      };
    case "task_done":
      return { code: "conflict", message: "This task is already done." };
    case "invalid_weight":
      return { code: "validation", message: "Weight must be greater than zero." };
    case "invalid_price":
      return { code: "validation", message: "Price per kg cannot be negative." };
    case "invalid_transition":
      return { code: "conflict", message: "That run status change is not allowed." };
    default:
      return { code: "internal", message: "Something went wrong. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Orders queue
// ---------------------------------------------------------------------------

export async function getOrders(
  organizationSlug: string,
  status?: OrderStatus,
): Promise<ActionResult<OrderListItem[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select("*, customer:customers(name), zone:delivery_zones(name)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return err("internal", "Failed to load orders");
  }

  return ok((data ?? []) as OrderListItem[]);
}

export async function getOrderDetail(
  organizationSlug: string,
  orderId: string,
): Promise<ActionResult<OrderWithItems>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      truck:trucks(*),
      customer:customers(id, name, phone)
    `,
    )
    .eq("id", orderId)
    .eq("organization_id", orgId)
    .single();

  if (error || !order) {
    return err("not_found", "Order not found");
  }

  const [{ data: items }, { data: tasks }] = await Promise.all([
    supabase.from("order_items").select("*, product:products(id, name, image_url)").eq("order_id", orderId),
    supabase.from("order_tasks").select("*").eq("order_id", orderId),
  ]);

  return ok({
    ...(order as OrderWithItems),
    items: (items ?? []) as OrderWithItems["items"],
    tasks: (tasks ?? []) as OrderWithItems["tasks"],
  });
}

export async function createManualOrder(
  rawInput: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  const parsed = PlaceOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid order input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  if (!input.customerId) {
    return err("validation", "customerId is required for manual orders");
  }

  const guard = await guardRoles(input.organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_org: orgId,
    p_zone: input.zoneId,
    p_slot: input.slotId,
    p_date: input.deliveryDate,
    p_address: input.address,
    p_notes: input.notes ?? null,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      mode: item.mode,
      quantity: item.quantity,
      size_min_kg: item.sizeMinKg,
      size_max_kg: item.sizeMaxKg,
      fallback: item.fallback,
    })),
    p_customer: input.customerId,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${input.organizationSlug}/orders`);
  return ok({ orderId: data as string });
}

export async function confirmOrder(rawInput: unknown): Promise<ActionResult> {
  const parsed = ConfirmOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid confirmation input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const guard = await guardRoles(input.organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("confirm_order", {
    p_order: input.orderId,
    p_decisions: input.decisions.map((d) => ({ item_id: d.itemId, available: d.available })),
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${input.organizationSlug}/orders`);
  revalidatePath(`/${input.organizationSlug}/orders/${input.orderId}`);
  return ok(undefined);
}

export async function cancelOrder(
  organizationSlug: string,
  orderId: string,
  reason: string,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_order", {
    p_order: orderId,
    p_reason: reason,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${organizationSlug}/orders`);
  revalidatePath(`/${organizationSlug}/orders/${orderId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Warehouse tasks (staff)
// ---------------------------------------------------------------------------

export async function getTodayTasks(
  organizationSlug: string,
): Promise<ActionResult<TaskWithOrder[]>> {
  const guard = await guardRoles(organizationSlug, STAFF_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  // Window includes tomorrow: orders are always booked for tomorrow at the
  // earliest (place_order window starts at current_date + 1), so staff load
  // and weigh a delivery the day before it goes out.
  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("order_tasks")
    .select(
      `
      *,
      order:orders!inner(
        *,
        zone:delivery_zones(*),
        slot:delivery_slots(*),
        truck:trucks(*),
        customer:customers(id, name, phone),
        items:order_items(*, product:products(id, name, image_url))
      )
    `,
    )
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .eq("order.status", "confirmed")
    .lte("order.delivery_date", horizon);

  if (error) {
    return err("internal", "Failed to load today's tasks");
  }

  return ok((data ?? []) as TaskWithOrder[]);
}

export async function completeTask(rawInput: unknown): Promise<ActionResult> {
  const parsed = CompleteTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid weights input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const guard = await guardRoles(input.organizationSlug, STAFF_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("complete_order_task", {
    p_task: input.taskId,
    p_weights: input.weights.map((w) => ({
      item_id: w.itemId,
      weight_kg: w.weightKg,
      pieces: w.pieces ?? null,
    })),
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${input.organizationSlug}/tasks`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function getRuns(
  organizationSlug: string,
  date: string,
): Promise<ActionResult<RunWithOrders[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data: runs, error } = await supabase
    .from("delivery_runs")
    .select("*, truck:trucks(*)")
    .eq("organization_id", orgId)
    .eq("run_date", date);

  if (error) {
    return err("internal", "Failed to load delivery runs");
  }

  const runIds = (runs ?? []).map((r: DeliveryRun) => r.id);
  const ordersByRun = new Map<string, OrderWithItems[]>();

  if (runIds.length > 0) {
    const { data: orders } = await supabase
      .from("orders")
      .select(
        `
        *,
        zone:delivery_zones(*),
        slot:delivery_slots(*),
        customer:customers(id, name, phone),
        items:order_items(*, product:products(id, name, image_url))
      `,
      )
      .in("run_id", runIds);

    for (const order of (orders ?? []) as OrderWithItems[]) {
      const key = order.run_id as string;
      const existing = ordersByRun.get(key) ?? [];
      existing.push(order);
      ordersByRun.set(key, existing);
    }
  }

  return ok(
    (runs ?? []).map((run: DeliveryRun & { truck?: Truck }) => ({
      ...run,
      orders: ordersByRun.get(run.id) ?? [],
    })) as RunWithOrders[],
  );
}

export async function setRunStatus(
  organizationSlug: string,
  runId: string,
  status: RunStatus,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_run_status", {
    p_run: runId,
    p_status: status,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}

export async function getRunManifest(
  organizationSlug: string,
  runId: string,
): Promise<ActionResult<RunWithOrders>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data: run, error } = await supabase
    .from("delivery_runs")
    .select("*, truck:trucks(*)")
    .eq("id", runId)
    .eq("organization_id", orgId)
    .single();

  if (error || !run) {
    return err("not_found", "Delivery run not found");
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      customer:customers(id, name, phone),
      items:order_items(*, product:products(id, name, image_url))
    `,
    )
    .eq("run_id", runId);

  return ok({
    ...(run as DeliveryRun & { truck?: Truck }),
    orders: (orders ?? []) as OrderWithItems[],
  });
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export async function getSettlementQueue(
  organizationSlug: string,
): Promise<ActionResult<OrderWithItems[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      truck:trucks(*),
      customer:customers(id, name, phone),
      items:order_items(*, product:products(id, name, image_url))
    `,
    )
    .eq("organization_id", orgId)
    .eq("status", "delivered")
    .order("delivery_date", { ascending: true });

  if (error) {
    return err("internal", "Failed to load the settlement queue");
  }

  return ok((data ?? []) as OrderWithItems[]);
}

export async function closeOrder(
  rawInput: unknown,
): Promise<ActionResult<{ total: number }>> {
  const parsed = CloseOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid settlement input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const guard = await guardRoles(input.organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("close_order", {
    p_order: input.orderId,
    p_lines: input.lines.map((l) => ({
      item_id: l.itemId,
      final_weight_kg: l.finalWeightKg,
      final_pieces: l.finalPieces ?? null,
      price_per_kg: l.pricePerKg,
    })),
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${input.organizationSlug}/orders`);
  revalidatePath(`/${input.organizationSlug}/orders/${input.orderId}`);
  return ok({ total: Number(data) });
}

export async function reopenOrder(
  organizationSlug: string,
  orderId: string,
  reason: string,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, ["owner", "org_admin"]);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_order", {
    p_order: orderId,
    p_reason: reason,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${organizationSlug}/orders`);
  revalidatePath(`/${organizationSlug}/orders/${orderId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Manager variant of the buyer-portal delivery-options lookup (used by the
// manual-order screen, which is gated by MANAGER_ROLES rather than
// requireBuyer).
// ---------------------------------------------------------------------------

export async function getDeliveryOptionsForOrg(
  organizationSlug: string,
  zoneId: string,
): Promise<ActionResult<DeliveryOption[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_delivery_options", {
    p_org: orgId,
    p_zone: zoneId,
  });

  if (error) {
    return err("internal", "Failed to load delivery options");
  }

  const options = (data ?? []) as Array<{
    option_date: string;
    slot_id: string;
    truck_id: string;
    truck_name: string;
    start_time: string;
    end_time: string;
    remaining: number | null;
  }>;

  return ok(
    options.map((row) => ({
      date: row.option_date,
      slotId: row.slot_id,
      truckId: row.truck_id,
      truckName: row.truck_name,
      startTime: row.start_time,
      endTime: row.end_time,
      remaining: row.remaining,
    })),
  );
}
```

- [ ] Step 4: Run the test again, confirm it passes

```
npx vitest run src/features/orders/tests/unit/order-actions.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1


 Test Files  1 passed (1)
      Tests  21 passed (21)
   Start at  22:19:47
   Duration  152ms (transform 24ms, setup 17ms, import 26ms, tests 9ms, environment 0ms)
```

- [ ] Step 5: Typecheck and lint

```
npm run typecheck
npm run lint
```
Expected: both exit 0 with no errors reported.

- [ ] Step 6: Run the full unit suite for the feature to confirm nothing in Tasks 6-8 regressed each other

```
npx vitest run src/features/orders/tests/unit/schedule-actions.test.ts src/features/orders/tests/unit/portal-actions.test.ts src/features/orders/tests/unit/order-actions.test.ts
```

Expected output:
```
 RUN  v4.1.9 /Users/alob/AyamNorliza-1


 Test Files  3 passed (3)
      Tests  29 passed (29)
   Start at  22:20:15
   Duration  180ms (transform 40ms, setup 30ms, import 45ms, tests 18ms, environment 0ms)
```

- [ ] Step 7: Commit

```
git add src/features/orders/server/order-actions.ts src/features/orders/tests/unit/order-actions.test.ts
git commit -m "feat(orders): add manager and staff order Server Actions"
```

---

CONTRACT CONCERN: The contract places the single, canonical `mapRpcError` helper in `order-actions.ts` (Task 8) and describes it as the shared RPC-error mapper, implying `portal-actions.ts` (Task 7) reuses it. But Task 7 is built and tested before Task 8 exists in this section's execution order, so `portal-actions.ts` cannot import `mapRpcError` from a file that doesn't exist yet at that point (and importing forward would leave Task 7 red until Task 8 lands, breaking independent TDD). I resolved this by giving `portal-actions.ts` its own small private `mapPortalRpcError` covering only the codes `place_order`/`cancel_order` can raise (`zone_not_found`, `slot_not_found`, `date_out_of_window`, `weekday_mismatch`, `date_blocked`, `slot_full`, `invalid_items`, `invalid_status`, `forbidden`), with matching wording to the canonical `mapRpcError` in `order-actions.ts`. This is intentional duplication, not a copy-paste slip — a follow-up refactor could hoist both into a single exported helper in `lib/order-model.ts` (which is already the pure, dependency-free home for order-pipeline logic) once both files exist, removing the duplication.

CONTRACT CONCERN: My assignment brief describes `order-actions.ts` as having "13 contract actions PLUS `getDeliveryOptionsForOrg`, PLUS `getRunManifest`, PLUS exported `mapRpcError`," but the contract's own exact-signature block for `server/order-actions.ts` lists 12 named functions (`getOrders`, `getOrderDetail`, `createManualOrder`, `confirmOrder`, `cancelOrder`, `getTodayTasks`, `completeTask`, `getRuns`, `setRunStatus`, `getSettlementQueue`, `closeOrder`, `reopenOrder`). Task 8 implements all 12 of those verbatim, plus the three explicitly-named additions from the assignment brief (`getDeliveryOptionsForOrg`, `getRunManifest`, `mapRpcError`) — nothing from the contract's list was dropped; the "13" in the brief appears to be a miscount against the contract's own list.
### Task 9: Cart v2 + product dialog

**Files:**
Modify: `src/features/buyer/components/cart-context.tsx` (full rewrite, currently 110 lines)
Modify: `src/features/buyer/components/product-card.tsx` (full rewrite, currently 194 lines)
Modify: `src/app/buyer_portal/[organizationSlug]/shop/product-grid.tsx` (edit hunk, currently 49 lines)
Modify: `src/app/buyer_portal/[organizationSlug]/cart/page.tsx` (full rewrite, currently 251 lines)
Delete: `src/app/api/buyer/cart/route.ts`

**Interfaces:**
Consumes: `OrderItemMode` (`"piece" | "kg"`), `OrderFallback`, `FALLBACKS`, `FALLBACK_LABELS: Record<OrderFallback, string>` from `@/features/orders/types` (Tasks 1-2); existing `Product`, `ProductVariant`, `CatalogWithProducts` from `../types` (buyer feature, unchanged).
Produces (consumed by Task 10 and later seller tasks that touch buyer UI):
```ts
export type CartLine = { productId: string; productName: string; mode: OrderItemMode; quantity: number; sizeMinKg: number; sizeMaxKg: number; fallback: OrderFallback };
// CartProvider/useCart value:
{ items: CartLine[]; addLine(line: CartLine): void; removeLine(index: number): void; updateLine(index: number, patch: Partial<CartLine>): void; clearCart(): void }
```

- [ ] Rewrite `src/features/buyer/components/cart-context.tsx` with the `CartLine` shape, `buyer_cart_v2` storage key, and the merge rule (same `productId`+`mode`+`sizeMinKg`+`sizeMaxKg`+`fallback` sums quantity, else appends a new line). Replace the entire file with:

```tsx
"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { OrderFallback, OrderItemMode } from "@/features/orders/types";

export type CartLine = {
  productId: string;
  productName: string;
  mode: OrderItemMode;
  quantity: number;
  sizeMinKg: number;
  sizeMaxKg: number;
  fallback: OrderFallback;
};

type CartContextType = {
  items: CartLine[];
  addLine: (line: CartLine) => void;
  removeLine: (index: number) => void;
  updateLine: (index: number, patch: Partial<CartLine>) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "buyer_cart_v2";

function sameLine(a: CartLine, b: CartLine) {
  return (
    a.productId === b.productId &&
    a.mode === b.mode &&
    a.sizeMinKg === b.sizeMinKg &&
    a.sizeMaxKg === b.sizeMaxKg &&
    a.fallback === b.fallback
  );
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);

  // Load cart from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (stored) {
      try {
        // Hydrating from localStorage must happen after mount: reading it in a
        // lazy initializer would make the client's first render differ from the
        // server's and trip a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(JSON.parse(stored));
      } catch {
        // Ignore invalid JSON
      }
    }
  }, []);

  // Save cart to localStorage on change
  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addLine = useCallback((line: CartLine) => {
    setItems((current) => {
      const index = current.findIndex((existing) => sameLine(existing, line));
      if (index === -1) {
        return [...current, line];
      }
      return current.map((existing, i) =>
        i === index
          ? {
              ...existing,
              quantity:
                Math.round((existing.quantity + line.quantity) * 1000) / 1000,
            }
          : existing,
      );
    });
  }, []);

  const removeLine = useCallback((index: number) => {
    setItems((current) => current.filter((_, i) => i !== index));
  }, []);

  const updateLine = useCallback(
    (index: number, patch: Partial<CartLine>) => {
      setItems((current) =>
        current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
      );
    },
    [],
  );

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  return (
    <CartContext.Provider
      value={{ items, addLine, removeLine, updateLine, clearCart }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
```

- [ ] Rewrite `src/features/buyer/components/product-card.tsx` so "Add to cart" opens a Dialog with a piece/kg mode toggle, a quantity input (integer step for piece, 0.1 step for kg), size-range min/max kg inputs, and a fallback picker built from `FALLBACK_LABELS` (using `Select`, since no `radio-group` primitive exists in `src/components/ui`). Variant selection stays display-only for indicative pricing. Replace the entire file with:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ShoppingCart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FALLBACKS,
  FALLBACK_LABELS,
  type OrderFallback,
  type OrderItemMode,
} from "@/features/orders/types";
import type { CartLine } from "./cart-context";
import type { Product, ProductVariant } from "../types";

type ProductCardProps = {
  product: Product;
  variants?: ProductVariant[];
  onAddToCart?: (line: CartLine) => void;
  showAddToCart?: boolean;
};

export function ProductCard({
  product,
  variants = [],
  onAddToCart,
  showAddToCart = true,
}: ProductCardProps) {
  const availableVariants = variants.filter((v) => v.is_available);
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    availableVariants[0]?.id ?? "",
  );
  const selectedVariant = variants.find((v) => v.id === selectedVariantId);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<OrderItemMode>(
    selectedVariant?.unit_type === "per_kg" ? "kg" : "piece",
  );
  const [quantity, setQuantity] = useState("1");
  const [sizeMinKg, setSizeMinKg] = useState("1.5");
  const [sizeMaxKg, setSizeMaxKg] = useState("1.7");
  const [fallback, setFallback] = useState<OrderFallback>("cancel");
  const [added, setAdded] = useState(false);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(price);
  };

  function resetDialog() {
    setMode(selectedVariant?.unit_type === "per_kg" ? "kg" : "piece");
    setQuantity("1");
    setSizeMinKg("1.5");
    setSizeMaxKg("1.7");
    setFallback("cancel");
  }

  const parsedQuantity = Number(quantity);
  const parsedMin = Number(sizeMinKg);
  const parsedMax = Number(sizeMaxKg);
  const isValid =
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (mode === "piece" ? Number.isInteger(parsedQuantity) : true) &&
    Number.isFinite(parsedMin) &&
    parsedMin >= 0.1 &&
    parsedMin <= 50 &&
    Number.isFinite(parsedMax) &&
    parsedMax >= 0.1 &&
    parsedMax <= 50 &&
    parsedMax >= parsedMin;

  const handleAddToCart = () => {
    if (!isValid || !onAddToCart) return;
    onAddToCart({
      productId: product.id,
      productName: product.name,
      mode,
      quantity: parsedQuantity,
      sizeMinKg: parsedMin,
      sizeMaxKg: parsedMax,
      fallback,
    });
    setAdded(true);
    setOpen(false);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <Card className="overflow-hidden">
      <Link href={`/product/${product.id}`} className="block">
        <div className="relative aspect-square bg-muted">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <ShoppingCart className="h-12 w-12" />
            </div>
          )}
        </div>
      </Link>
      <CardHeader className="p-4 pb-2">
        <Link href={`/product/${product.id}`}>
          <CardTitle className="line-clamp-1 text-lg font-semibold hover:text-primary">
            {product.name}
          </CardTitle>
        </Link>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {product.description}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex items-center justify-between">
          <div>
            {selectedVariant ? (
              <span className="text-lg font-bold">
                {formatPrice(Number(selectedVariant.price_per_unit))}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {selectedVariant.unit_type === "per_kg" ? "/kg" : "each"}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Price varies</span>
            )}
          </div>
          {availableVariants.length > 1 && (
            <Select
              value={selectedVariantId}
              onValueChange={(id) => setSelectedVariantId(id)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                {availableVariants.map((variant) => (
                  <SelectItem key={variant.id} value={variant.id}>
                    {variant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {selectedVariant && (
          <p className="mt-1 text-xs text-muted-foreground">
            Indicative price — final price is set per kg when your order is
            closed.
          </p>
        )}
      </CardContent>
      {showAddToCart && onAddToCart && (
        <CardFooter className="p-4 pt-0">
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (next) resetDialog();
            }}
          >
            <DialogTrigger asChild>
              <Button className="w-full" disabled={added}>
                {added ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Added!
                  </>
                ) : (
                  <>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Add to Cart
                  </>
                )}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{product.name}</DialogTitle>
                <DialogDescription>
                  Choose how you would like to order this product.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Order by</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={mode === "piece" ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => setMode("piece")}
                    >
                      Piece
                    </Button>
                    <Button
                      type="button"
                      variant={mode === "kg" ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => setMode("kg")}
                    >
                      Kg
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quantity">
                    Quantity {mode === "piece" ? "(birds)" : "(kg)"}
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    inputMode={mode === "piece" ? "numeric" : "decimal"}
                    min={mode === "piece" ? 1 : 0.1}
                    step={mode === "piece" ? 1 : 0.1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="size-min">Min size (kg/bird)</Label>
                    <Input
                      id="size-min"
                      type="number"
                      inputMode="decimal"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={sizeMinKg}
                      onChange={(e) => setSizeMinKg(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="size-max">Max size (kg/bird)</Label>
                    <Input
                      id="size-max"
                      type="number"
                      inputMode="decimal"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={sizeMaxKg}
                      onChange={(e) => setSizeMaxKg(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fallback">Can&apos;t get this size?</Label>
                  <Select
                    value={fallback}
                    onValueChange={(v) => setFallback(v as OrderFallback)}
                  >
                    <SelectTrigger id="fallback" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FALLBACKS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {FALLBACK_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" onClick={handleAddToCart} disabled={!isValid}>
                  Add to cart
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      )}
    </Card>
  );
}
```

- [ ] Update `src/app/buyer_portal/[organizationSlug]/shop/product-grid.tsx` to wire the new `addLine` API and drop the `as any` cast on `product.variants`. Apply this edit:

```diff
 "use client";

 import { ProductCard } from "@/features/buyer/components/product-card";
 import { useCart } from "@/features/buyer/components/cart-context";
-import type { CatalogWithProducts } from "@/features/buyer/types";
-import type { ProductVariant } from "@/features/buyer/types";
+import type { CartLine } from "@/features/buyer/components/cart-context";
+import type { CatalogWithProducts } from "@/features/buyer/types";

 type ProductGridProps = {
   categories: CatalogWithProducts[];
 };

 export function ProductGrid({ categories }: ProductGridProps) {
-  const { addItem } = useCart();
+  const { addLine } = useCart();

-  const handleAddToCart = (variantId: string, quantity: number) => {
-    addItem(variantId, quantity);
+  const handleAddToCart = (line: CartLine) => {
+    addLine(line);
   };
```

```diff
             {category.products.map((product) => (
               <ProductCard
                 key={product.id}
                 product={product}
-                variants={(product as any).variants || []}
+                variants={product.variants ?? []}
                 onAddToCart={handleAddToCart}
                 showAddToCart={true}
               />
             ))}
```

- [ ] Rewrite `src/app/buyer_portal/[organizationSlug]/cart/page.tsx` to read straight from `useCart()` — no more `/api/buyer/cart` enrichment fetch, no price/subtotal (pricing is set at order close, not in cart). Replace the entire file with:

```tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Minus, Plus, ShoppingCart, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/features/buyer/components/cart-context";
import { FALLBACK_LABELS } from "@/features/orders/types";

type CartPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default function CartPage({ params }: CartPageProps) {
  const router = useRouter();
  const { items, updateLine, removeLine } = useCart();
  const [organizationSlug, setOrganizationSlug] = useState<string>("");

  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  const handleCheckout = () => {
    if (items.length === 0) return;
    router.push(`/buyer_portal/${organizationSlug}/checkout`);
  };

  if (items.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <ShoppingCart className="mb-4 h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">
          Add some products to get started!
        </p>
        <Button asChild className="mt-6">
          <Link href={`/buyer_portal/${organizationSlug}/shop`}>Browse Products</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-8 text-3xl font-bold">Shopping Cart</h1>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items ({items.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item, index) => {
                const step = item.mode === "kg" ? 0.1 : 1;
                const min = item.mode === "kg" ? 0.1 : 1;
                return (
                  <div
                    key={`${item.productId}-${index}`}
                    className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.sizeMinKg}-{item.sizeMaxKg} kg / bird
                      </p>
                      <Badge variant="outline" className="mt-1">
                        {FALLBACK_LABELS[item.fallback]}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateLine(index, {
                              quantity: Math.max(
                                min,
                                Math.round((item.quantity - step) * 1000) / 1000,
                              ),
                            })
                          }
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span
                          className={
                            item.mode === "kg" ? "w-16 text-center" : "w-8 text-center"
                          }
                        >
                          {item.mode === "kg" ? `${item.quantity} kg` : item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateLine(index, {
                              quantity: Math.round((item.quantity + step) * 1000) / 1000,
                            })
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeLine(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle>Ready to order?</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Pricing is confirmed after your order is weighed and closed —
                pick a delivery slot next.
              </p>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button className="w-full" size="lg" onClick={handleCheckout}>
                Proceed to Checkout
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link href={`/buyer_portal/${organizationSlug}/shop`}>
                  Continue Shopping
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

- [ ] Delete the cart-enrichment API route (cart lines already carry `productName`, so nothing needs to enrich them):

```bash
git rm "src/app/api/buyer/cart/route.ts"
```

- [ ] Run typecheck and lint, expect both clean:

```bash
npm run typecheck
```
Expected: exits 0, no output (no type errors).

```bash
npm run lint
```
Expected: exits 0, `✔ No ESLint warnings or errors` (or equivalent "no problems" output) for every touched file.

- [ ] Manual verification click-path (dev server, pilot org):

```bash
npm run dev
```
1. Open `http://localhost:3000/buyer_portal/ayam-norliza-pilot/shop`.
2. Click "Add to Cart" on any product — a dialog opens titled with the product name.
3. Click the "Kg" toggle button (it becomes the selected/filled button), set Quantity to `2.5`, Min size to `1.4`, Max size to `1.6`, and change "Can't get this size?" to "Mix sizes".
4. Click "Add to cart" — dialog closes, the trigger button briefly shows "Added!".
5. Click "Add to Cart" again on the same product, leave defaults (Piece / 1 / 1.5–1.7 / Cancel my order), click "Add to cart" — this is a *different* line (different mode+size+fallback than step 3), so it must NOT merge with the kg line.
6. Navigate to `http://localhost:3000/buyer_portal/ayam-norliza-pilot/cart` — verify two separate line items: one showing "2.5 kg", "1.4-1.6 kg / bird", badge "Mix sizes"; the other showing "1", "1.5-1.7 kg / bird", badge "Cancel my order".
7. Click "+" on the piece line twice — quantity goes to 3 (integer steps, no decimals).
8. Click the trash icon on the kg line — it disappears, only the piece line remains.
9. Open browser devtools → Application → Local Storage → verify key `buyer_cart_v2` holds a JSON array of objects with `productId`, `productName`, `mode`, `quantity`, `sizeMinKg`, `sizeMaxKg`, `fallback` fields, and that there is no `buyer_cart` (old key) being written anymore.
10. Confirm `GET /api/buyer/cart` now 404s (the route file is gone) — the cart and checkout pages no longer call it.

- [ ] Commit:

```bash
git add "src/features/buyer/components/cart-context.tsx" "src/features/buyer/components/product-card.tsx" "src/app/buyer_portal/[organizationSlug]/shop/product-grid.tsx" "src/app/buyer_portal/[organizationSlug]/cart/page.tsx"
git commit -m "$(cat <<'EOF'
feat(portal): rewrite cart to CartLine v2 and add product order dialog

Cart lines now carry mode/quantity/size-range/fallback instead of a
variant id, so cart and checkout no longer need to enrich items via
/api/buyer/cart. That route is deleted.
EOF
)"
```

---

### Task 10: Checkout + my-orders rebuild

**Files:**
Modify: `src/app/buyer_portal/[organizationSlug]/checkout/page.tsx` (full rewrite, currently 315 lines)
Modify: `src/app/buyer_portal/[organizationSlug]/orders/page.tsx` (full rewrite, currently 126 lines)
Modify: `src/app/buyer_portal/[organizationSlug]/orders/[orderId]/page.tsx` (full rewrite, currently 216 lines)
Create: `src/app/buyer_portal/[organizationSlug]/orders/[orderId]/cancel-order-button.tsx`

**Interfaces:**
Consumes (from Task 9): `CartLine`, `useCart()` from `@/features/buyer/components/cart-context`.
Consumes (from `server/portal-actions.ts`, Task 5):
```ts
getActiveZones(organizationSlug: string): Promise<ActionResult<DeliveryZone[]>>
getDeliveryOptions(organizationSlug: string, zoneId: string): Promise<ActionResult<DeliveryOption[]>>
placeOrder(rawInput: unknown): Promise<ActionResult<{ orderId: string }>>
getMyOrders(): Promise<ActionResult<OrderListItem[]>>
getMyOrder(orderId: string): Promise<ActionResult<OrderWithItems>>
cancelMyOrder(orderId: string, reason?: string): Promise<ActionResult>
```
Consumes (from `types.ts` / `lib/order-model.ts`, Tasks 1-2):
```ts
ORDER_STATUS_LABELS: Record<OrderStatus, string>
ORDER_STATUS_COLORS: Record<OrderStatus, string>
FALLBACK_LABELS: Record<OrderFallback, string>
type DeliveryZone = { id: string; organization_id: string; name: string; display_order: number; is_active: boolean; ... }
type DeliveryOption = { date: string; slotId: string; truckId: string; truckName: string; startTime: string; endTime: string; remaining: number | null }
type OrderListItem = Order & { customer?: { name: string }; zone?: { name: string } }
type OrderWithItems = Order & { items: OrderItemWithProduct[]; zone?: DeliveryZone; slot?: DeliverySlot; truck?: Truck; customer?: {...}; tasks?: OrderTask[]; weight_log?: OrderWeightLog[] }
formatPrice(amount: number): string
formatWeight(kg: number): string
describeFallback(applied: OrderFallback | null): string | null
```
Consumes: `requireBuyerOrRedirect(organizationSlug: string)` from `@/lib/auth/buyer-auth` (existing).
Produces: `CancelOrderButton({ organizationSlug, orderId }: { organizationSlug: string; orderId: string })` — local client component, no external consumers.

- [ ] Rewrite `src/app/buyer_portal/[organizationSlug]/checkout/page.tsx`: zone `Select` populated from `getActiveZones`, address + notes `Textarea`s, delivery options fetched via `getDeliveryOptions(organizationSlug, zoneId)` on zone change, grouped by date and rendered as clickable "radio cards" (`role="radio"` buttons inside a `role="radiogroup"` — there is no `radio-group` primitive in `src/components/ui` to use instead), empty-options state showing the exact copy "No delivery available for this area yet.", and submit calling `placeOrder` then showing a success screen. Replace the entire file with:

```tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useCart } from "@/features/buyer/components/cart-context";
import {
  getActiveZones,
  getDeliveryOptions,
  placeOrder,
} from "@/features/orders/server/portal-actions";
import type { DeliveryZone, DeliveryOption } from "@/features/orders/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle } from "lucide-react";

type CheckoutPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

function optionKey(option: DeliveryOption) {
  return `${option.date}-${option.slotId}`;
}

export default function CheckoutPage({ params }: CheckoutPageProps) {
  const router = useRouter();
  const { items, clearCart } = useCart();
  const { toast } = useToast();

  const [organizationSlug, setOrganizationSlug] = useState<string>("");
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [zoneId, setZoneId] = useState<string>("");
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderId, setOrderId] = useState<string>("");

  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  useEffect(() => {
    if (!organizationSlug) return;
    let cancelled = false;
    setZonesLoading(true);
    getActiveZones(organizationSlug).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setZones(result.data);
      }
      setZonesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug]);

  useEffect(() => {
    if (!organizationSlug || !zoneId) {
      setOptions([]);
      setSelectedKey("");
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    setSelectedKey("");
    getDeliveryOptions(organizationSlug, zoneId).then((result) => {
      if (cancelled) return;
      setOptions(result.ok ? result.data : []);
      setOptionsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug, zoneId]);

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, DeliveryOption[]>();
    for (const option of options) {
      const list = groups.get(option.date) ?? [];
      list.push(option);
      groups.set(option.date, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const selectedOption = options.find((o) => optionKey(o) === selectedKey) ?? null;

  const canSubmit =
    items.length > 0 &&
    zoneId !== "" &&
    address.trim().length > 0 &&
    selectedOption !== null &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedOption) return;

    setSubmitting(true);
    const result = await placeOrder({
      organizationSlug,
      zoneId,
      slotId: selectedOption.slotId,
      deliveryDate: selectedOption.date,
      address: address.trim(),
      notes: notes.trim() || undefined,
      items: items.map((item) => ({
        productId: item.productId,
        mode: item.mode,
        quantity: item.quantity,
        sizeMinKg: item.sizeMinKg,
        sizeMaxKg: item.sizeMaxKg,
        fallback: item.fallback,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast({
        title: "Order failed",
        description: result.message,
        variant: "destructive",
      });
      return;
    }

    setOrderId(result.data.orderId);
    setOrderComplete(true);
    clearCart();

    toast({
      title: "Order placed!",
      description: "Your order has been successfully placed.",
    });
  };

  if (orderComplete) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="mx-auto max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl">Order Placed!</CardTitle>
            <CardDescription>
              Thank you for your order. We will process it shortly.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Order ID: {orderId.slice(0, 8)}...
            </p>
            <Button
              className="w-full"
              onClick={() => router.push(`/buyer_portal/${organizationSlug}/orders`)}
            >
              View My Orders
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push(`/buyer_portal/${organizationSlug}/shop`)}
            >
              Continue Shopping
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">
          Add some products to get started!
        </p>
        <Button asChild className="mt-6">
          <a href={`/buyer_portal/${organizationSlug}/shop`}>Browse Products</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-8 text-3xl font-bold">Checkout</h1>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Delivery Details</CardTitle>
                <CardDescription>
                  Pick your delivery zone, address, and a time slot.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="zone">Delivery Zone</Label>
                  <Select
                    value={zoneId}
                    onValueChange={(v) => setZoneId(v)}
                    disabled={zonesLoading || zones.length === 0}
                  >
                    <SelectTrigger id="zone" className="w-full">
                      <SelectValue
                        placeholder={zonesLoading ? "Loading zones..." : "Select a zone"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Delivery Address</Label>
                  <Textarea
                    id="address"
                    placeholder="Enter your full delivery address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Order Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any special instructions for your order?"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Delivery Slot</CardTitle>
                <CardDescription>
                  {zoneId === ""
                    ? "Select a zone to see delivery dates and times."
                    : "Choose a date and truck time window."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {zoneId !== "" && optionsLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading delivery options...
                  </div>
                )}
                {zoneId !== "" && !optionsLoading && groupedOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No delivery available for this area yet.
                  </p>
                )}
                {!optionsLoading && groupedOptions.length > 0 && (
                  <div className="space-y-4" role="radiogroup" aria-label="Delivery slot">
                    {groupedOptions.map(([date, dateOptions]) => (
                      <div key={date}>
                        <p className="mb-2 text-sm font-medium">
                          {format(new Date(`${date}T00:00:00`), "EEEE, d MMM yyyy")}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {dateOptions.map((option) => {
                            const key = optionKey(option);
                            const isSelected = key === selectedKey;
                            return (
                              <button
                                key={key}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                onClick={() => setSelectedKey(key)}
                                className={`rounded-2xl border p-3 text-left text-sm transition-colors ${
                                  isSelected
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:bg-muted"
                                }`}
                              >
                                <p className="font-medium">{option.truckName}</p>
                                <p className="text-muted-foreground">
                                  {option.startTime.slice(0, 5)}–{option.endTime.slice(0, 5)}
                                </p>
                                {option.remaining !== null && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {option.remaining} slot{option.remaining === 1 ? "" : "s"} left
                                  </p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="sticky top-20">
              <CardHeader>
                <CardTitle>Place Order</CardTitle>
                <CardDescription>
                  {items.length} item{items.length === 1 ? "" : "s"} in your
                  cart. Final pricing is set per kg when your order closes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((item, index) => (
                  <div key={`${item.productId}-${index}`} className="flex justify-between text-sm">
                    <span>
                      {item.productName} ×{" "}
                      {item.mode === "kg" ? `${item.quantity} kg` : item.quantity}
                    </span>
                  </div>
                ))}
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" size="lg" disabled={!canSubmit}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Placing Order...
                    </>
                  ) : (
                    "Place Order"
                  )}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
```

- [ ] Rewrite `src/app/buyer_portal/[organizationSlug]/orders/page.tsx` as a server component listing `getMyOrders()` with the new status labels/colors. Replace the entire file with:

```tsx
import Link from "next/link";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getMyOrders } from "@/features/orders/server/portal-actions";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Package, ArrowLeft } from "lucide-react";

type OrdersPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function OrdersPage({ params }: OrdersPageProps) {
  const { organizationSlug } = await params;
  await requireBuyerOrRedirect(organizationSlug);
  const result = await getMyOrders();

  if (!result.ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Failed to load orders.</p>
      </div>
    );
  }

  const orders = result.data;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/buyer_portal/${organizationSlug}/shop`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Orders</h1>
          <p className="text-muted-foreground">View your order history</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center py-12">
            <Package className="mb-4 h-16 w-16 text-muted-foreground" />
            <h2 className="text-xl font-semibold">No orders yet</h2>
            <p className="mt-2 text-muted-foreground">
              Start shopping to see your orders here.
            </p>
            <Button asChild className="mt-6">
              <Link href={`/buyer_portal/${organizationSlug}/shop`}>Browse Products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      Order #{order.id.slice(0, 8)}
                    </CardTitle>
                    <CardDescription>
                      {format(new Date(order.created_at), "d MMM yyyy, HH:mm")}
                      {order.zone?.name ? ` · ${order.zone.name}` : ""}
                    </CardDescription>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      ORDER_STATUS_COLORS[order.status]
                    }`}
                  >
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Delivery:{" "}
                      {format(new Date(`${order.delivery_date}T00:00:00`), "d MMM yyyy")}
                    </p>
                    {order.delivery_address && (
                      <p className="mt-1 max-w-md truncate text-sm text-muted-foreground">
                        {order.delivery_address}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {order.status === "closed"
                        ? formatPrice(Number(order.total_amount))
                        : "Priced at close"}
                    </p>
                    <Button variant="outline" size="sm" asChild className="mt-2">
                      <Link href={`/buyer_portal/${organizationSlug}/orders/${order.id}`}>
                        View Details
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] Create `src/app/buyer_portal/[organizationSlug]/orders/[orderId]/cancel-order-button.tsx` — the client-side interactive piece (confirm dialog + `cancelMyOrder` call + `router.refresh()`) that the otherwise-server order detail page delegates to, matching the repo's server-page/client-child convention:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cancelMyOrder } from "@/features/orders/server/portal-actions";

type CancelOrderButtonProps = {
  organizationSlug: string;
  orderId: string;
};

export function CancelOrderButton({ orderId }: CancelOrderButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCancel = async () => {
    setSubmitting(true);
    const result = await cancelMyOrder(orderId, reason.trim() || undefined);
    setSubmitting(false);

    if (!result.ok) {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      });
      return;
    }

    setOpen(false);
    toast({ title: "Order cancelled" });
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <X className="mr-2 h-4 w-4" />
          Cancel order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this order?</DialogTitle>
          <DialogDescription>
            This cannot be undone. Let us know why (optional).
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Keep order
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelling...
              </>
            ) : (
              "Cancel order"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `organizationSlug` is accepted in the props type for call-site clarity (matches how the page passes it) but isn't needed inside the component body, so it's omitted from the destructure to avoid an unused-var lint warning.

- [ ] Rewrite `src/app/buyer_portal/[organizationSlug]/orders/[orderId]/page.tsx` as a server component using `getMyOrder`, showing per-line size range (`"1.5-1.7 kg / bird"`), a `FALLBACK_LABELS` chip, an amber `fallback_applied` badge via `describeFallback`, closed-order weights/price-per-kg/line-total/total via `formatPrice`/`formatWeight`, and the `CancelOrderButton` while `status === "pending"`. Replace the entire file with:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getMyOrder } from "@/features/orders/server/portal-actions";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, FALLBACK_LABELS } from "@/features/orders/types";
import { formatPrice, formatWeight, describeFallback } from "@/features/orders/lib/order-model";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MapPin, FileText, ArrowLeft } from "lucide-react";
import { CancelOrderButton } from "./cancel-order-button";

type OrderDetailPageProps = {
  params: Promise<{ organizationSlug: string; orderId: string }>;
};

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { organizationSlug, orderId } = await params;
  await requireBuyerOrRedirect(organizationSlug);

  const result = await getMyOrder(orderId);

  if (!result.ok) {
    notFound();
  }

  const order = result.data;
  const isClosed = order.status === "closed";

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/buyer_portal/${organizationSlug}/orders`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Order Details</h1>
          <p className="text-muted-foreground">Order #{order.id.slice(0, 8)}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order Status</CardTitle>
          <CardDescription>
            Placed {format(new Date(order.created_at), "PPpp")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                ORDER_STATUS_COLORS[order.status]
              }`}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </span>
            {order.status === "pending" && (
              <CancelOrderButton organizationSlug={organizationSlug} orderId={order.id} />
            )}
          </div>

          {order.status === "cancelled" && order.notes && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
              <p className="font-medium">This order was cancelled.</p>
              <p className="mt-1 whitespace-pre-line">{order.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {order.items.map((item) => {
              const fallbackNote = describeFallback(item.fallback_applied);
              return (
                <div key={item.id} className="border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {item.product?.name ?? "Unknown product"}
                        {item.is_cancelled && (
                          <Badge variant="destructive" className="ml-2">
                            Cancelled
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.mode === "kg"
                          ? `${Number(item.quantity)} kg`
                          : `${Number(item.quantity)} birds`}
                        {" · "}
                        {Number(item.size_min_kg)}-{Number(item.size_max_kg)} kg / bird
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline">{FALLBACK_LABELS[item.fallback]}</Badge>
                        {fallbackNote && (
                          <Badge className="bg-amber-100 text-amber-800">
                            Applied: {fallbackNote}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {isClosed && item.final_weight_kg !== null && item.price_per_kg !== null && (
                      <div className="text-right">
                        <p className="font-medium">{formatPrice(Number(item.line_total))}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatWeight(Number(item.final_weight_kg))} ×{" "}
                          {formatPrice(Number(item.price_per_kg))}/kg
                        </p>
                        {item.final_pieces !== null && (
                          <p className="text-xs text-muted-foreground">
                            {Number(item.final_pieces)} pieces
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isClosed && (
            <div className="mt-4 border-t pt-4">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{formatPrice(Number(order.total_amount))}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {order.delivery_address && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Delivery Address</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{order.delivery_address}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {format(new Date(`${order.delivery_date}T00:00:00`), "EEEE, d MMM yyyy")}
              </p>
            </CardContent>
          </Card>
        )}

        {order.notes && order.status !== "cancelled" && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Order Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{order.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] Run typecheck and lint, expect both clean:

```bash
npm run typecheck
```
Expected: exits 0, no output.

```bash
npm run lint
```
Expected: exits 0, `✔ No ESLint warnings or errors` (or equivalent) for every touched file.

- [ ] Manual verification click-path — place-order flow (dev server, pilot org, buyer seed account `buyer@ayam-norliza-pilot.example` / `test-only-password-12-chars`):

```bash
npm run dev
```
1. Open `http://localhost:3000/buyer_portal/ayam-norliza-pilot/login`, sign in with the buyer seed account.
2. Go to `http://localhost:3000/buyer_portal/ayam-norliza-pilot/shop`, add one product to cart (Piece mode, quantity 2, default size range, fallback "Bigger is ok").
3. Go to `http://localhost:3000/buyer_portal/ayam-norliza-pilot/checkout`.
4. Select a zone from "Delivery Zone" — the "Delivery Slot" card switches to a loading spinner, then either shows date-grouped truck/time cards (Zone 1/2 → TRK-A, Zone 3 → TRK-B, per seed data) or the exact empty-state text "No delivery available for this area yet." if the zone has no coverage.
5. Fill in an address, click one of the delivery slot cards (it highlights with a primary border), optionally add notes.
6. Click "Place Order" — button shows "Placing Order...", then the success screen appears with a truncated order id.
7. Click "View My Orders" — lands on `/buyer_portal/ayam-norliza-pilot/orders`, the new order appears with a blue "Pending" pill and "Priced at close" instead of a dollar amount.

- [ ] Manual verification click-path — order detail + cancel flow:

1. Click "View Details" on the pending order from the previous walkthrough.
2. Verify the item line shows quantity, `"<min>-<max> kg / bird"`, a `FALLBACK_LABELS` outline chip (e.g. "Bigger is ok"), and no amber "Applied:" badge yet (nothing has been confirmed).
3. Click "Cancel order" — a confirm dialog opens; type a reason, click "Cancel order" in the dialog.
4. Toast "Order cancelled" appears, page refreshes, status pill turns red "Cancelled", the "Cancel order" button is gone, and a red banner shows "This order was cancelled." with the typed reason.
5. Using the manager/seller app (or `psql`/Supabase SQL editor against the pilot org) drive a second order through `confirm_order` with one line's `available=false` and its `fallback` set to something other than `cancel`, then through `complete_order_task`, `set_run_status('delivered')`, and `close_order` with a weight/price — then reload that order's buyer detail page and confirm: the amber "Applied: <fallback label>" badge appears on the affected line, and once closed the line shows `formatWeight(final_weight_kg) × formatPrice(price_per_kg)/kg`, the line total, and the order total via `formatPrice(total_amount)` at the bottom of the Items card.

- [ ] Commit:

```bash
git add "src/app/buyer_portal/[organizationSlug]/checkout/page.tsx" "src/app/buyer_portal/[organizationSlug]/orders/page.tsx" "src/app/buyer_portal/[organizationSlug]/orders/[orderId]/page.tsx" "src/app/buyer_portal/[organizationSlug]/orders/[orderId]/cancel-order-button.tsx"
git commit -m "$(cat <<'EOF'
feat(portal): rebuild checkout and my-orders for the order pipeline

Checkout now drives zone -> delivery-option -> placeOrder instead of
the old flat variant checkout. Orders list/detail show the new status
set, size ranges, fallback badges, and closed-order settlement figures,
with a buyer-side cancel action while an order is still pending.
EOF
)"
```
### Task 11: Schedule admin + nav + staff gating

**Files:**
Modify:
- `src/features/dashboard/components/dashboard-shell-model.ts` (role-aware nav)
- `src/features/dashboard/components/app-sidebar.tsx` (lines 56-77: accept/forward `role`)
- `src/app/(seller)/[organizationSlug]/layout.tsx` (lines 1-3, 28-38, 48-54: allow staff, active-only member filter, pass role)

Test:
- `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts` (extend)

Create:
- `src/app/(seller)/[organizationSlug]/delivery/page.tsx`
- `src/app/(seller)/[organizationSlug]/delivery/delivery-client.tsx`

**Interfaces:**
Consumes:
- `requireOrgRole(organizationSlug: string, roles: readonly string[]): Promise<{ orgId: string; userId: string; role: string }>` and `OrderPermissionError` from `@/features/orders/server/guards` (Task 6)
- `MANAGER_ROLES`, `STAFF_ROLES` from `@/features/orders/lib/roles` (Task 6)
- `getDeliverySetup(organizationSlug): ActionResult<DeliverySetup>`, `createZone/updateZone/deleteZone`, `createTruck/updateTruck/deleteTruck`, `setTruckZones(organizationSlug, truckId, zoneIds: string[]): ActionResult`, `createSlot/updateSlot/deleteSlot`, `createBlock/deleteBlock` from `@/features/orders/server/schedule-actions` (Task 8)
- `DeliveryZone, Truck, TruckZone, DeliverySlot, ScheduleBlock, DeliverySetup, ActionResult` types from `@/features/orders/types` (Task 2)

Produces:
- `getDashboardSidebarGroups({ organizationSlug, pathname, role }: { organizationSlug: string; pathname: string; role?: string }): DashboardRouteGroup[]` — used by `app-sidebar.tsx` and (unchanged signature call) `dashboard-shell-header.tsx`
- `AppSidebar` accepting an optional `role?: string` prop, forwarded to the model — consumed by `layout.tsx`
- Route `/${organizationSlug}/delivery` (schedule admin UI) that later tasks (runs, tasks pages) link to from the sidebar

---

#### Part A — `dashboard-shell-model.ts`: role-aware nav (TDD)

- [ ] Step 1: Add the failing test cases. Edit `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts`:

  Replace:
  ```ts
  it("formats fallback user initials from display name or email", () => {
    expect(getUserInitials("Ayam Norliza", "owner@example.com")).toBe("AN");
    expect(getUserInitials("", "owner@example.com")).toBe("O");
  });
});
  ```
  with:
  ```ts
  it("formats fallback user initials from display name or email", () => {
    expect(getUserInitials("Ayam Norliza", "owner@example.com")).toBe("AN");
    expect(getUserInitials("", "owner@example.com")).toBe("O");
  });

  it("returns only the warehouse group for staff roles", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/tasks",
      role: "inventory",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: "Warehouse", isActive: true });
    expect(groups[0]?.items).toEqual([
      {
        title: "Warehouse tasks",
        href: "/ayam-norliza-pilot/tasks",
        isActive: true,
      },
    ]);
  });

  it("returns only the warehouse group for the logistics role too", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/orders",
      role: "logistics",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("Warehouse");
    expect(groups[0]?.items[0]).toMatchObject({ isActive: false });
  });

  it("returns the full nav with delivery segments for manager roles", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/delivery",
      role: "seller",
    });

    expect(groups).toHaveLength(2);
    const salesTitles = groups[1]?.items.map((item) => item.title);
    expect(salesTitles).toEqual([
      "Products",
      "Orders",
      "Customers",
      "Delivery setup",
      "Delivery runs",
      "Warehouse tasks",
    ]);
    const deliverySetup = groups[1]?.items.find((item) => item.title === "Delivery setup");
    expect(deliverySetup).toMatchObject({
      href: "/ayam-norliza-pilot/delivery",
      isActive: true,
    });
  });

  it("returns the full nav when role is undefined (back-compat)", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/runs",
    });

    expect(groups).toHaveLength(2);
    const runsItem = groups[1]?.items.find((item) => item.title === "Delivery runs");
    expect(runsItem).toMatchObject({
      href: "/ayam-norliza-pilot/runs",
      isActive: true,
    });
  });
});
  ```

- [ ] Step 2: Run `npx vitest run src/features/dashboard/tests/unit/dashboard-shell-model.test.ts`. Expected FAIL — the 5 pre-existing tests pass, the 4 new ones fail:
  ```
  FAIL  src/features/dashboard/tests/unit/dashboard-shell-model.test.ts > dashboard shell model > returns only the warehouse group for staff roles
  AssertionError: expected 2 to be 1 // Object.is equality
    - Expected: 1
    + Actual: 2

  FAIL  src/features/dashboard/tests/unit/dashboard-shell-model.test.ts > dashboard shell model > returns only the warehouse group for the logistics role too
  AssertionError: expected 2 to be 1 // Object.is equality

  FAIL  src/features/dashboard/tests/unit/dashboard-shell-model.test.ts > dashboard shell model > returns the full nav with delivery segments for manager roles
  AssertionError: expected [ 'Products', 'Orders', 'Customers' ] to deeply equal [ 'Products', 'Orders', 'Customers', …]

  FAIL  src/features/dashboard/tests/unit/dashboard-shell-model.test.ts > dashboard shell model > returns the full nav when role is undefined (back-compat)
  AssertionError: expected undefined to match object { href: '/ayam-norliza-pilot/runs', …}

  Test Files  1 failed (1)
       Tests  4 failed | 5 passed (9)
  ```

- [ ] Step 3: Implement the role-aware model. Edit `src/features/dashboard/components/dashboard-shell-model.ts`:

  Replace:
  ```ts
  type DashboardPathInput = {
    organizationSlug: string;
    pathname: string;
  };

  const routeGroups = [
    {
      title: "Access control",
      items: [
        { title: "Organization", segment: "settings/organization" },
        { title: "Users", segment: "settings/users" },
        { title: "Roles", segment: "settings/roles" },
        { title: "Access reviews", segment: "settings/access-reviews" },
        { title: "Support sessions", segment: "settings/support-sessions" },
        { title: "Audit log", segment: "settings/audit-log" },
      ],
    },
    {
      title: "Sales",
      items: [
        { title: "Products", segment: "products" },
        { title: "Orders", segment: "orders" },
        { title: "Customers", segment: "customers" },
      ],
    },
  ] as const;

  export function getDashboardSidebarGroups({
    organizationSlug,
    pathname,
  }: DashboardPathInput): DashboardRouteGroup[] {
    return routeGroups.map((group) => {
      const items = group.items.map((item) => {
        const href = `/${organizationSlug}/${item.segment}`;
        return {
          title: item.title,
          href,
          isActive: isRouteActive(pathname, href),
        };
      });

      return {
        title: group.title,
        isActive: items.some((item) => item.isActive),
        items,
      };
    });
  }
  ```
  with:
  ```ts
  type DashboardPathInput = {
    organizationSlug: string;
    pathname: string;
    role?: string;
  };

  const routeGroups = [
    {
      title: "Access control",
      items: [
        { title: "Organization", segment: "settings/organization" },
        { title: "Users", segment: "settings/users" },
        { title: "Roles", segment: "settings/roles" },
        { title: "Access reviews", segment: "settings/access-reviews" },
        { title: "Support sessions", segment: "settings/support-sessions" },
        { title: "Audit log", segment: "settings/audit-log" },
      ],
    },
    {
      title: "Sales",
      items: [
        { title: "Products", segment: "products" },
        { title: "Orders", segment: "orders" },
        { title: "Customers", segment: "customers" },
        { title: "Delivery setup", segment: "delivery" },
        { title: "Delivery runs", segment: "runs" },
        { title: "Warehouse tasks", segment: "tasks" },
      ],
    },
  ] as const;

  // Roles that only see the warehouse queue — no schedule admin, catalog, or
  // customer data. Kept local (not imported from @/features/orders/lib/roles)
  // so this dashboard-layer file has no dependency on the orders feature.
  const STAFF_ONLY_ROLES = ["inventory", "logistics"] as const;

  export function getDashboardSidebarGroups({
    organizationSlug,
    pathname,
    role,
  }: DashboardPathInput): DashboardRouteGroup[] {
    if (role && (STAFF_ONLY_ROLES as readonly string[]).includes(role)) {
      const href = `/${organizationSlug}/tasks`;
      const items = [
        { title: "Warehouse tasks", href, isActive: isRouteActive(pathname, href) },
      ];
      return [{ title: "Warehouse", isActive: items.some((item) => item.isActive), items }];
    }

    return routeGroups.map((group) => {
      const items = group.items.map((item) => {
        const href = `/${organizationSlug}/${item.segment}`;
        return {
          title: item.title,
          href,
          isActive: isRouteActive(pathname, href),
        };
      });

      return {
        title: group.title,
        isActive: items.some((item) => item.isActive),
        items,
      };
    });
  }
  ```

- [ ] Step 4: Run `npx vitest run src/features/dashboard/tests/unit/dashboard-shell-model.test.ts`. Expected PASS:
  ```
  ✓ src/features/dashboard/tests/unit/dashboard-shell-model.test.ts (9 tests)

  Test Files  1 passed (1)
       Tests  9 passed (9)
  ```

---

#### Part B — `app-sidebar.tsx`: accept and forward `role`

No new unit tests — `AppSidebar` is a thin render wrapper around the model function already covered by Part A; per repo convention this file gets typecheck + lint + manual verification only (no `@testing-library` in this repo).

- [ ] Step 5: Edit `src/features/dashboard/components/app-sidebar.tsx`.

  Replace:
  ```tsx
  import {
    BadgeCheck,
    Building2,
    ChevronRight,
    ChevronsUpDown,
    LogOut,
    Settings,
    ShieldCheck,
    ShoppingCart,
    UserRound,
    type LucideIcon,
  } from "lucide-react";
  ```
  with:
  ```tsx
  import {
    BadgeCheck,
    Building2,
    ChevronRight,
    ChevronsUpDown,
    LogOut,
    Settings,
    ShieldCheck,
    ShoppingCart,
    UserRound,
    Warehouse,
    type LucideIcon,
  } from "lucide-react";
  ```

  Replace:
  ```tsx
  type AppSidebarProps = {
    organizationName: string;
    organizationSlug: string;
    organizationRegion: string | null;
    userName: string;
    userEmail: string;
  };

  const groupIcons: Record<string, LucideIcon> = {
    "Access control": ShieldCheck,
    Sales: ShoppingCart,
  } as const;

  export function AppSidebar({
    organizationName,
    organizationSlug,
    organizationRegion,
    userName,
    userEmail,
  }: AppSidebarProps) {
    const pathname = usePathname();
    const groups = getDashboardSidebarGroups({ organizationSlug, pathname });
  ```
  with:
  ```tsx
  type AppSidebarProps = {
    organizationName: string;
    organizationSlug: string;
    organizationRegion: string | null;
    userName: string;
    userEmail: string;
    role?: string;
  };

  const groupIcons: Record<string, LucideIcon> = {
    "Access control": ShieldCheck,
    Sales: ShoppingCart,
    Warehouse: Warehouse,
  } as const;

  export function AppSidebar({
    organizationName,
    organizationSlug,
    organizationRegion,
    userName,
    userEmail,
    role,
  }: AppSidebarProps) {
    const pathname = usePathname();
    const groups = getDashboardSidebarGroups({ organizationSlug, pathname, role });
  ```

---

#### Part C — seller `layout.tsx`: allow staff, active-only member filter, pass role

- [ ] Step 6: Edit `src/app/(seller)/[organizationSlug]/layout.tsx`.

  Replace:
  ```tsx
  import { notFound, redirect } from "next/navigation";
  import { requireUserOrRedirect } from "@/lib/auth/require-user";
  import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
  ```
  with:
  ```tsx
  import { notFound, redirect } from "next/navigation";
  import { requireUserOrRedirect } from "@/lib/auth/require-user";
  import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
  import { STAFF_ROLES } from "@/features/orders/lib/roles";
  ```

  Replace:
  ```tsx
    const { data: member } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .single();

    // Only allow owner, org_admin, or seller roles
    if (!member || !["owner", "org_admin", "seller"].includes(member.role)) {
      redirect(`/${organizationSlug}`);
    }
  ```
  with:
  ```tsx
    const { data: member } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    // Allow managers (owner/org_admin/seller) and warehouse staff
    // (inventory/logistics). Staff get a restricted nav — see AppSidebar —
    // and manager-only pages redirect them to /tasks (see CONTRACT CONCERN
    // at the end of this file for why that redirect lives per-page).
    if (!member || !(STAFF_ROLES as readonly string[]).includes(member.role)) {
      redirect(`/${organizationSlug}`);
    }
  ```

  Replace:
  ```tsx
          <AppSidebar
            organizationName={org.name}
            organizationSlug={organizationSlug}
            organizationRegion={org.region}
            userEmail={userEmail}
            userName={userName}
          />
  ```
  with:
  ```tsx
          <AppSidebar
            organizationName={org.name}
            organizationSlug={organizationSlug}
            organizationRegion={org.region}
            userEmail={userEmail}
            userName={userName}
            role={member.role}
          />
  ```

---

#### Part D — delivery schedule admin page + client

- [ ] Step 7: Create `src/app/(seller)/[organizationSlug]/delivery/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";
  import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
  import { MANAGER_ROLES } from "@/features/orders/lib/roles";
  import { getDeliverySetup } from "@/features/orders/server/schedule-actions";
  import { DeliveryClient } from "./delivery-client";

  export default async function DeliveryPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string }>;
  }) {
    const { organizationSlug } = await params;

    try {
      await requireOrgRole(organizationSlug, MANAGER_ROLES);
    } catch (error) {
      if (error instanceof OrderPermissionError) {
        redirect(`/${organizationSlug}/tasks`);
      }
      throw error;
    }

    const result = await getDeliverySetup(organizationSlug);
    if (!result.ok) {
      throw new Error(result.message);
    }

    return <DeliveryClient organizationSlug={organizationSlug} initialSetup={result.data} />;
  }
  ```

  Note: no `getOrganizationBySlug`/`notFound()` call here — the parent `layout.tsx` already resolves the org and calls `notFound()` before this page renders, so by the time this runs the org is guaranteed to exist; `requireOrgRole` re-resolves it internally for the role check.

- [ ] Step 8: Create `src/app/(seller)/[organizationSlug]/delivery/delivery-client.tsx`:
  ```tsx
  "use client";

  import { useState } from "react";
  import { Pencil, Plus, Trash2 } from "lucide-react";
  import {
    createBlock,
    createSlot,
    createTruck,
    createZone,
    deleteBlock,
    deleteSlot,
    deleteTruck,
    deleteZone,
    setTruckZones,
    updateSlot,
    updateTruck,
    updateZone,
  } from "@/features/orders/server/schedule-actions";
  import type {
    DeliverySetup,
    DeliverySlot,
    DeliveryZone,
    ScheduleBlock,
    Truck,
    TruckZone,
  } from "@/features/orders/types";
  import { Button } from "@/components/ui/button";
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { useToast } from "@/hooks/use-toast";

  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  type ZoneDialogState = { zone?: DeliveryZone } | null;
  type TruckDialogState = { truck?: Truck } | null;
  type SlotDialogState = { truckId: string; slot?: DeliverySlot } | null;

  type DeliveryClientProps = {
    organizationSlug: string;
    initialSetup: DeliverySetup;
  };

  export function DeliveryClient({ organizationSlug, initialSetup }: DeliveryClientProps) {
    const { toast } = useToast();
    const [zones, setZones] = useState<DeliveryZone[]>(initialSetup.zones);
    const [trucks, setTrucks] = useState<Truck[]>(initialSetup.trucks);
    const [truckZones, setTruckZonesList] = useState<TruckZone[]>(initialSetup.truckZones);
    const [slots, setSlots] = useState<DeliverySlot[]>(initialSetup.slots);
    const [blocks, setBlocks] = useState<ScheduleBlock[]>(initialSetup.blocks);

    const [zoneDialog, setZoneDialog] = useState<ZoneDialogState>(null);
    const [truckDialog, setTruckDialog] = useState<TruckDialogState>(null);
    const [slotDialog, setSlotDialog] = useState<SlotDialogState>(null);
    const [blockForm, setBlockForm] = useState({ blockDate: "", truckId: "all", reason: "" });

    function fail(message: string) {
      toast({ title: "Error", description: message, variant: "destructive" });
    }

    // -- Zones ----------------------------------------------------------

    async function handleZoneSubmit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      const editing = zoneDialog?.zone;
      const input = {
        name: String(form.get("name") ?? ""),
        displayOrder: Number(form.get("displayOrder") ?? 0),
        isActive: form.get("isActive") === "on",
      };
      const result = editing
        ? await updateZone(organizationSlug, editing.id, input)
        : await createZone(organizationSlug, input);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setZones((prev) =>
        editing
          ? prev.map((z) => (z.id === result.data.id ? result.data : z))
          : [...prev, result.data],
      );
      setZoneDialog(null);
      toast({ title: editing ? "Zone updated" : "Zone created" });
    }

    async function handleDeleteZone(zone: DeliveryZone) {
      if (!confirm(`Delete zone "${zone.name}"?`)) return;
      const result = await deleteZone(organizationSlug, zone.id);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setZones((prev) => prev.filter((z) => z.id !== zone.id));
      setTruckZonesList((prev) => prev.filter((tz) => tz.zone_id !== zone.id));
      toast({ title: "Zone deleted" });
    }

    // -- Trucks -----------------------------------------------------------

    async function handleTruckSubmit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      const editing = truckDialog?.truck;
      const input = {
        name: String(form.get("name") ?? ""),
        code: String(form.get("code") ?? ""),
        isActive: form.get("isActive") === "on",
      };
      const result = editing
        ? await updateTruck(organizationSlug, editing.id, input)
        : await createTruck(organizationSlug, input);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setTrucks((prev) =>
        editing
          ? prev.map((t) => (t.id === result.data.id ? result.data : t))
          : [...prev, result.data],
      );
      setTruckDialog(null);
      toast({ title: editing ? "Truck updated" : "Truck created" });
    }

    async function handleDeleteTruck(truck: Truck) {
      if (!confirm(`Delete truck "${truck.name}"?`)) return;
      const result = await deleteTruck(organizationSlug, truck.id);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setTrucks((prev) => prev.filter((t) => t.id !== truck.id));
      setTruckZonesList((prev) => prev.filter((tz) => tz.truck_id !== truck.id));
      setSlots((prev) => prev.filter((s) => s.truck_id !== truck.id));
      setBlocks((prev) => prev.filter((b) => b.truck_id !== truck.id));
      toast({ title: "Truck deleted" });
    }

    async function handleToggleTruckZone(truck: Truck, zoneId: string, checked: boolean) {
      const currentZoneIds = truckZones
        .filter((tz) => tz.truck_id === truck.id)
        .map((tz) => tz.zone_id);
      const nextZoneIds = checked
        ? [...currentZoneIds, zoneId]
        : currentZoneIds.filter((id) => id !== zoneId);
      const result = await setTruckZones(organizationSlug, truck.id, nextZoneIds);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setTruckZonesList((prev) => [
        ...prev.filter((tz) => tz.truck_id !== truck.id),
        ...nextZoneIds.map((id) => ({
          truck_id: truck.id,
          zone_id: id,
          organization_id: truck.organization_id,
        })),
      ]);
    }

    // -- Slots --------------------------------------------------------------

    async function handleSlotSubmit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      if (!slotDialog) return;
      const form = new FormData(e.currentTarget);
      const editing = slotDialog.slot;
      const maxOrdersRaw = String(form.get("maxOrders") ?? "").trim();
      const input = {
        truckId: slotDialog.truckId,
        weekday: Number(form.get("weekday")),
        startTime: String(form.get("startTime") ?? ""),
        endTime: String(form.get("endTime") ?? ""),
        maxOrders: maxOrdersRaw === "" ? null : Number(maxOrdersRaw),
        isActive: form.get("isActive") === "on",
      };
      const result = editing
        ? await updateSlot(organizationSlug, editing.id, input)
        : await createSlot(organizationSlug, input);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setSlots((prev) =>
        editing
          ? prev.map((s) => (s.id === result.data.id ? result.data : s))
          : [...prev, result.data],
      );
      setSlotDialog(null);
      toast({ title: editing ? "Slot updated" : "Slot created" });
    }

    async function handleDeleteSlot(slot: DeliverySlot) {
      if (!confirm("Delete this delivery slot?")) return;
      const result = await deleteSlot(organizationSlug, slot.id);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setSlots((prev) => prev.filter((s) => s.id !== slot.id));
      toast({ title: "Slot deleted" });
    }

    // -- Blocked dates --------------------------------------------------

    async function handleAddBlock(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      const input = {
        blockDate: blockForm.blockDate,
        truckId: blockForm.truckId === "all" ? null : blockForm.truckId,
        reason: blockForm.reason.trim() === "" ? undefined : blockForm.reason.trim(),
      };
      const result = await createBlock(organizationSlug, input);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setBlocks((prev) => [...prev, result.data]);
      setBlockForm({ blockDate: "", truckId: "all", reason: "" });
      toast({ title: "Blocked date added" });
    }

    async function handleDeleteBlock(block: ScheduleBlock) {
      if (!confirm("Remove this blocked date?")) return;
      const result = await deleteBlock(organizationSlug, block.id);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      setBlocks((prev) => prev.filter((b) => b.id !== block.id));
      toast({ title: "Blocked date removed" });
    }

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Delivery Setup</h1>
          <p className="text-muted-foreground">
            Zones, trucks, weekly slots, and blocked dates for the delivery schedule
          </p>
        </div>

        <Tabs defaultValue="zones">
          <TabsList>
            <TabsTrigger value="zones">Zones</TabsTrigger>
            <TabsTrigger value="trucks">Trucks</TabsTrigger>
            <TabsTrigger value="slots">Slots</TabsTrigger>
            <TabsTrigger value="blocks">Blocked dates</TabsTrigger>
          </TabsList>

          <TabsContent value="zones" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setZoneDialog({})}>
                <Plus className="mr-2 h-4 w-4" />
                Add zone
              </Button>
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zones.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No zones yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    zones.map((zone) => (
                      <TableRow key={zone.id}>
                        <TableCell className="font-medium">{zone.name}</TableCell>
                        <TableCell>{zone.display_order}</TableCell>
                        <TableCell>{zone.is_active ? "Active" : "Inactive"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setZoneDialog({ zone })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDeleteZone(zone)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="trucks" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setTruckDialog({})}>
                <Plus className="mr-2 h-4 w-4" />
                Add truck
              </Button>
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Zones covered</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trucks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No trucks yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    trucks.map((truck) => {
                      const coveredZoneIds = new Set(
                        truckZones
                          .filter((tz) => tz.truck_id === truck.id)
                          .map((tz) => tz.zone_id),
                      );
                      return (
                        <TableRow key={truck.id}>
                          <TableCell className="font-medium">{truck.name}</TableCell>
                          <TableCell>{truck.code}</TableCell>
                          <TableCell>{truck.is_active ? "Active" : "Inactive"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-3">
                              {zones.map((zone) => (
                                <label key={zone.id} className="flex items-center gap-1.5 text-sm">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={coveredZoneIds.has(zone.id)}
                                    onChange={(e) =>
                                      handleToggleTruckZone(truck, zone.id, e.target.checked)
                                    }
                                  />
                                  {zone.name}
                                </label>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setTruckDialog({ truck })}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDeleteTruck(truck)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="slots" className="space-y-6">
            {trucks.length === 0 ? (
              <p className="text-muted-foreground">Add a truck first to configure its slots.</p>
            ) : (
              trucks.map((truck) => {
                const truckSlots = slots
                  .filter((s) => s.truck_id === truck.id)
                  .sort(
                    (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
                  );
                return (
                  <div key={truck.id} className="space-y-2 rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        {truck.name} <span className="text-muted-foreground">({truck.code})</span>
                      </h3>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSlotDialog({ truckId: truck.id })}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add slot
                      </Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Weekday</TableHead>
                          <TableHead>Start</TableHead>
                          <TableHead>End</TableHead>
                          <TableHead>Max orders</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-24">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {truckSlots.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={6}
                              className="py-6 text-center text-muted-foreground"
                            >
                              No slots yet
                            </TableCell>
                          </TableRow>
                        ) : (
                          truckSlots.map((slot) => (
                            <TableRow key={slot.id}>
                              <TableCell>{WEEKDAY_LABELS[slot.weekday]}</TableCell>
                              <TableCell>{slot.start_time}</TableCell>
                              <TableCell>{slot.end_time}</TableCell>
                              <TableCell>{slot.max_orders ?? "Unlimited"}</TableCell>
                              <TableCell>{slot.is_active ? "Active" : "Inactive"}</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setSlotDialog({ truckId: truck.id, slot })}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleDeleteSlot(slot)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="blocks" className="space-y-4">
            <form
              onSubmit={handleAddBlock}
              className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
            >
              <div className="space-y-2">
                <Label htmlFor="block-date">Date</Label>
                <Input
                  id="block-date"
                  type="date"
                  value={blockForm.blockDate}
                  onChange={(e) =>
                    setBlockForm((prev) => ({ ...prev, blockDate: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Truck</Label>
                <Select
                  value={blockForm.truckId}
                  onValueChange={(value) => setBlockForm((prev) => ({ ...prev, truckId: value }))}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All trucks</SelectItem>
                    {trucks.map((truck) => (
                      <SelectItem key={truck.id} value={truck.id}>
                        {truck.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="block-reason">Reason</Label>
                <Input
                  id="block-reason"
                  value={blockForm.reason}
                  onChange={(e) => setBlockForm((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="e.g. Public holiday"
                />
              </div>
              <Button type="submit">
                <Plus className="mr-2 h-4 w-4" />
                Add blocked date
              </Button>
            </form>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Truck</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-16">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No blocked dates
                      </TableCell>
                    </TableRow>
                  ) : (
                    blocks.map((block) => (
                      <TableRow key={block.id}>
                        <TableCell>{block.block_date}</TableCell>
                        <TableCell>
                          {block.truck_id
                            ? (trucks.find((t) => t.id === block.truck_id)?.name ??
                              "Unknown truck")
                            : "All trucks"}
                        </TableCell>
                        <TableCell>{block.reason ?? "-"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDeleteBlock(block)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        <Dialog
          open={zoneDialog !== null}
          onOpenChange={(open) => {
            if (!open) setZoneDialog(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{zoneDialog?.zone ? "Edit zone" : "Add zone"}</DialogTitle>
            </DialogHeader>
            <ZoneForm
              key={zoneDialog?.zone?.id ?? "new-zone"}
              zone={zoneDialog?.zone}
              onSubmit={handleZoneSubmit}
              onCancel={() => setZoneDialog(null)}
            />
          </DialogContent>
        </Dialog>

        <Dialog
          open={truckDialog !== null}
          onOpenChange={(open) => {
            if (!open) setTruckDialog(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{truckDialog?.truck ? "Edit truck" : "Add truck"}</DialogTitle>
            </DialogHeader>
            <TruckForm
              key={truckDialog?.truck?.id ?? "new-truck"}
              truck={truckDialog?.truck}
              onSubmit={handleTruckSubmit}
              onCancel={() => setTruckDialog(null)}
            />
          </DialogContent>
        </Dialog>

        <Dialog
          open={slotDialog !== null}
          onOpenChange={(open) => {
            if (!open) setSlotDialog(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{slotDialog?.slot ? "Edit slot" : "Add slot"}</DialogTitle>
            </DialogHeader>
            {slotDialog ? (
              <SlotForm
                key={slotDialog.slot?.id ?? `new-slot-${slotDialog.truckId}`}
                slot={slotDialog.slot}
                onSubmit={handleSlotSubmit}
                onCancel={() => setSlotDialog(null)}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  function ZoneForm({
    zone,
    onSubmit,
    onCancel,
  }: {
    zone?: DeliveryZone;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    onCancel: () => void;
  }) {
    const [isActive, setIsActive] = useState(zone?.is_active ?? true);

    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="zone-name">Name</Label>
          <Input id="zone-name" name="name" defaultValue={zone?.name ?? ""} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zone-order">Display order</Label>
          <Input
            id="zone-order"
            name="displayOrder"
            type="number"
            defaultValue={zone?.display_order ?? 0}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="zone-active"
            type="checkbox"
            name="isActive"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="zone-active">Active</Label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{zone ? "Save changes" : "Create"}</Button>
        </div>
      </form>
    );
  }

  function TruckForm({
    truck,
    onSubmit,
    onCancel,
  }: {
    truck?: Truck;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    onCancel: () => void;
  }) {
    const [isActive, setIsActive] = useState(truck?.is_active ?? true);

    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="truck-name">Name</Label>
          <Input id="truck-name" name="name" defaultValue={truck?.name ?? ""} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="truck-code">Code</Label>
          <Input id="truck-code" name="code" defaultValue={truck?.code ?? ""} required />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="truck-active"
            type="checkbox"
            name="isActive"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="truck-active">Active</Label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{truck ? "Save changes" : "Create"}</Button>
        </div>
      </form>
    );
  }

  function SlotForm({
    slot,
    onSubmit,
    onCancel,
  }: {
    slot?: DeliverySlot;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    onCancel: () => void;
  }) {
    const [weekday, setWeekday] = useState(String(slot?.weekday ?? 1));
    const [isActive, setIsActive] = useState(slot?.is_active ?? true);

    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Weekday</Label>
          <Select value={weekday} onValueChange={setWeekday}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_LABELS.map((label, index) => (
                <SelectItem key={label} value={String(index)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input type="hidden" name="weekday" value={weekday} readOnly />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="slot-start">Start time</Label>
            <Input
              id="slot-start"
              name="startTime"
              type="time"
              defaultValue={slot?.start_time?.slice(0, 5) ?? "09:00"}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slot-end">End time</Label>
            <Input
              id="slot-end"
              name="endTime"
              type="time"
              defaultValue={slot?.end_time?.slice(0, 5) ?? "12:00"}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="slot-max">Max orders (blank = unlimited)</Label>
          <Input
            id="slot-max"
            name="maxOrders"
            type="number"
            min="1"
            defaultValue={slot?.max_orders ?? ""}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="slot-active"
            type="checkbox"
            name="isActive"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="slot-active">Active</Label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{slot ? "Save changes" : "Create"}</Button>
        </div>
      </form>
    );
  }
  ```

---

#### Verification and commit

- [ ] Step 9: Run `npm run typecheck`. Expected clean (no output / exit 0, no TS errors in the six touched/created files).

- [ ] Step 10: Run `npm run lint`. Expected clean (no eslint errors/warnings in the six touched/created files).

- [ ] Step 11: Manual verification (requires Tasks 1, 6, and 8 already merged — DB migrations, `guards.ts`/`roles.ts`, and `schedule-actions.ts`). Start the app (`npm run dev`), sign in as the pilot org owner/seller on `ayam-norliza-pilot`:
  1. Open `/ayam-norliza-pilot/products`. In the sidebar's **Sales** group, confirm the item order is Products, Orders, Customers, Delivery setup, Delivery runs, Warehouse tasks.
  2. Click **Delivery setup** — confirm it navigates to `/ayam-norliza-pilot/delivery` and renders four tabs: Zones, Trucks, Slots, Blocked dates.
  3. Zones tab: click **Add zone**, name "Zone 4", submit — confirm a "Zone created" toast and a new row. Click the pencil icon, change Display order to 5, save — confirm the cell updates to 5 and a "Zone updated" toast appears.
  4. Trucks tab: click **Add truck**, name "Test Truck", code "TT1", submit — confirm the row appears. Check the "Zone 4" checkbox on its row, then reload the page (F5) and reopen the Trucks tab — confirm the checkbox is still checked (persisted via `setTruckZones`).
  5. Slots tab: under "Test Truck", click **Add slot**, weekday "Mon", start 09:00, end 12:00, submit — confirm the row appears under that truck.
  6. Blocked dates tab: pick a date, leave Truck as "All trucks", reason "Test", submit — confirm it appears in the list; click its trash icon and confirm the browser `confirm()` dialog, then confirm the row disappears.
  7. Trucks tab: delete "Test Truck" (trash icon, confirm) — confirm it disappears from Trucks AND its slot rows disappear from the Slots tab.
  8. Sign out. Sign in as (or temporarily set via Supabase Studio) a member whose `organization_members.role` is `inventory`. Confirm the sidebar shows a single **Warehouse** group with one **Warehouse tasks** item only. Manually type `/ayam-norliza-pilot/delivery` into the browser address bar — confirm the browser URL changes to `/ayam-norliza-pilot/tasks` (the redirect fires even if the `/tasks` page itself isn't built yet by another task).

- [ ] Step 12: Commit.
  ```bash
  git add src/features/dashboard/components/dashboard-shell-model.ts src/features/dashboard/components/app-sidebar.tsx src/features/dashboard/tests/unit/dashboard-shell-model.test.ts "src/app/(seller)/[organizationSlug]/layout.tsx" "src/app/(seller)/[organizationSlug]/delivery/page.tsx" "src/app/(seller)/[organizationSlug]/delivery/delivery-client.tsx"
  git commit -m "feat(seller): add delivery schedule admin and staff-aware nav"
  ```

---

CONTRACT CONCERN:

1. RESOLVED — Task 6's `guards.ts` as written in this plan DOES export `requireRoleOrRedirect(organizationSlug, roles)` (redirects to `/${organizationSlug}`). `delivery/page.tsx` in this task deliberately keeps the inline `try { requireOrgRole } catch (OrderPermissionError) { redirect }` form because its failure destination differs (staff bounce to `/${organizationSlug}/tasks`, not the org root). See "Cross-task reconciliation notes" item 2 at the top of this plan — both patterns are correct; do not unify them into the wrong destination.

2. The contract's `layout.tsx` line ("staff-only roles (inventory/logistics) hitting a non-`/tasks` path redirect to `/${organizationSlug}/tasks`") cannot be implemented centrally in `layout.tsx` as written: Next.js App Router server-component layouts have no built-in access to the current request pathname (no `usePathname()` on the server, and this repo has no `middleware.ts` to inject one via a header). This file implements the redirect at the per-page level instead — `delivery/page.tsx` redirects staff to `/tasks` when `requireOrgRole(slug, MANAGER_ROLES)` throws `OrderPermissionError`. The other manager-only seller pages this contract lists (`runs/page.tsx`, and the rewritten `products`, `orders`, `customers` pages) are owned by other tasks and must replicate this same per-page try/catch pattern to get equivalent behavior; `layout.tsx` itself only enforces the broader "staff or manager, else bounce to org root" check.
### Task 12: Manager orders queue + detail + manual order

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/orders/page.tsx` (full rewrite; current 23 lines)
- Modify: `src/app/(seller)/[organizationSlug]/orders/orders-client.tsx` (full rewrite; current 180 lines)
- Modify: `src/app/(seller)/[organizationSlug]/orders/[orderId]/page.tsx` (full rewrite; current 23 lines)
- Modify: `src/app/(seller)/[organizationSlug]/orders/[orderId]/order-detail-client.tsx` (full rewrite; current 236 lines)
- Modify: `src/app/(seller)/[organizationSlug]/orders/new/page.tsx` (no code change required — verified still compatible, see step 5)
- Modify: `src/app/(seller)/[organizationSlug]/orders/new/new-order-client.tsx` (full rewrite; current 486 lines)

**Interfaces:**
Consumes (exact contract signatures):
```ts
// src/features/orders/server/order-actions.ts
getOrders(organizationSlug: string, status?: OrderStatus): Promise<ActionResult<OrderListItem[]>>
getOrderDetail(organizationSlug: string, orderId: string): Promise<ActionResult<OrderWithItems>>
createManualOrder(rawInput: unknown): Promise<ActionResult<{ orderId: string }>>
confirmOrder(rawInput: unknown): Promise<ActionResult>
cancelOrder(organizationSlug: string, orderId: string, reason: string): Promise<ActionResult>
closeOrder(rawInput: unknown): Promise<ActionResult<{ total: number }>>
reopenOrder(organizationSlug: string, orderId: string, reason: string): Promise<ActionResult>
getDeliveryOptionsForOrg(organizationSlug: string, zoneId: string): Promise<ActionResult<DeliveryOption[]>>

// src/features/orders/server/portal-actions.ts
getActiveZones(organizationSlug: string): Promise<ActionResult<DeliveryZone[]>>

// src/features/orders/server/guards.ts
requireOrgRole(organizationSlug: string, roles: readonly string[]): Promise<{ orgId: string; userId: string; role: string }>
class OrderPermissionError extends Error { readonly code = "forbidden" }

// src/features/orders/lib/roles.ts
MANAGER_ROLES: readonly ["owner", "org_admin", "seller"]

// src/features/orders/lib/order-model.ts
formatPrice(amount: number): string
formatWeight(kg: number): string
computeLineTotal(finalWeightKg: number, pricePerKg: number): number
weightWarnings(item: Pick<OrderItem, "id" | "mode" | "quantity" | "size_min_kg" | "size_max_kg" | "warehouse_weight_kg" | "final_weight_kg" | "final_pieces" | "warehouse_pieces">): WeightWarning[]
describeFallback(applied: OrderFallback | null): string | null

// src/features/orders/types.ts
ORDER_STATUS_LABELS: Record<OrderStatus, string>
ORDER_STATUS_COLORS: Record<OrderStatus, string>
FALLBACKS: readonly ["cancel", "mix", "upsize", "downsize"]
FALLBACK_LABELS: Record<OrderFallback, string>
ORDER_STATUSES: readonly OrderStatus[]
type OrderWithItems = Order & { items: OrderItemWithProduct[]; zone?: DeliveryZone; slot?: DeliverySlot; truck?: Truck; customer?: { id: string; name: string; phone: string }; tasks?: OrderTask[]; weight_log?: OrderWeightLog[] }
type OrderListItem = Order & { customer?: { name: string }; zone?: { name: string } }
type DeliveryOption = { date: string; slotId: string; truckId: string; truckName: string; startTime: string; endTime: string; remaining: number | null }

// src/features/seller/server/actions.ts (existing, unmodified — stays per contract)
searchCustomers(orgId: string, query: string): Promise<Customer[]>
createCustomer(orgId: string, input: Omit<CustomerInsert, "organization_id" | "created_by">, orgSlug?: string): Promise<Customer>
getCatalogForOrdering(orgId: string): Promise<Array<{ id: string; name: string; products: Array<{ id: string; name: string }> }>>
```
Produces (route components later tasks/e2e specs rely on):
```ts
// route: /${organizationSlug}/orders
export function OrdersClient(props: { organizationSlug: string; initialOrders: OrderListItem[] }): JSX.Element

// route: /${organizationSlug}/orders/${orderId}
export function OrderDetailClient(props: { organizationSlug: string; callerRole: string; initialOrder: OrderWithItems | null }): JSX.Element

// route: /${organizationSlug}/orders/new
export function NewOrderClient(props: { organizationSlug: string; organizationId: string }): JSX.Element
```

---

- [ ] **Step 1: Rewrite `orders/page.tsx` — fetch the full order list server-side**

  Full file:
  ```tsx
  import { notFound } from "next/navigation";
  import { getOrders } from "@/features/orders/server/order-actions";
  import { OrdersClient } from "./orders-client";

  export default async function OrdersPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string }>;
  }) {
    const { organizationSlug } = await params;
    const result = await getOrders(organizationSlug);
    if (!result.ok) notFound();

    return (
      <OrdersClient organizationSlug={organizationSlug} initialOrders={result.data} />
    );
  }
  ```
  No `status` argument is passed — the client owns tab filtering over the full list so switching tabs is instant with no round-trip.

- [ ] **Step 2: Rewrite `orders/orders-client.tsx` — status tabs with counts, table rows link to detail**

  Full file:
  ```tsx
  "use client";

  import { useMemo, useState } from "react";
  import { useRouter } from "next/navigation";
  import type { OrderListItem, OrderStatus } from "@/features/orders/types";
  import { ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/features/orders/types";
  import { formatPrice } from "@/features/orders/lib/order-model";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Button } from "@/components/ui/button";
  import { Badge } from "@/components/ui/badge";
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus } from "lucide-react";

  type OrdersClientProps = {
    organizationSlug: string;
    initialOrders: OrderListItem[];
  };

  const TABS = ["all", ...ORDER_STATUSES] as const;
  type TabValue = (typeof TABS)[number];

  const TAB_LABELS: Record<TabValue, string> = {
    all: "All",
    ...ORDER_STATUS_LABELS,
  };

  export function OrdersClient({ organizationSlug, initialOrders }: OrdersClientProps) {
    const router = useRouter();
    const [orders] = useState(initialOrders);
    const [activeTab, setActiveTab] = useState<TabValue>("pending");

    const counts = useMemo(() => {
      const base: Record<TabValue, number> = {
        all: orders.length,
        pending: 0,
        confirmed: 0,
        ready: 0,
        delivered: 0,
        closed: 0,
        cancelled: 0,
      };
      for (const order of orders) {
        base[order.status] += 1;
      }
      return base;
    }, [orders]);

    const visibleOrders = activeTab === "all" ? orders : orders.filter((o) => o.status === activeTab);

    const formatDate = (date: string) =>
      new Date(date).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Orders</h1>
            <p className="text-muted-foreground">Manage the order pipeline</p>
          </div>
          <Button onClick={() => router.push(`/${organizationSlug}/orders/new`)}>
            <Plus className="mr-2 h-4 w-4" />
            New Order
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)}>
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {TAB_LABELS[tab]}
                <Badge variant="secondary" className="ml-1.5">
                  {counts[tab]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeTab}>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Delivery date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No orders in this view
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleOrders.map((order) => (
                      <TableRow
                        key={order.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/${organizationSlug}/orders/${order.id}`)}
                      >
                        <TableCell className="font-mono text-sm">{order.id.slice(0, 8)}</TableCell>
                        <TableCell>{order.customer?.name ?? "Unknown"}</TableCell>
                        <TableCell>{order.zone?.name ?? "-"}</TableCell>
                        <TableCell>
                          <Badge className={ORDER_STATUS_COLORS[order.status]}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(order.delivery_date)}</TableCell>
                        <TableCell className="text-right font-medium">{formatPrice(order.total_amount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    );
  }
  ```

- [ ] **Step 3: Rewrite `orders/[orderId]/page.tsx` — resolve caller role for the Reopen gate, fetch order detail**

  Full file:
  ```tsx
  import { notFound, redirect } from "next/navigation";
  import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
  import { MANAGER_ROLES } from "@/features/orders/lib/roles";
  import { getOrderDetail } from "@/features/orders/server/order-actions";
  import { OrderDetailClient } from "./order-detail-client";

  export default async function OrderDetailPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string; orderId: string }>;
  }) {
    const { organizationSlug, orderId } = await params;

    let callerRole: string;
    try {
      ({ role: callerRole } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
    } catch (error) {
      if (error instanceof OrderPermissionError) {
        redirect(`/${organizationSlug}`);
      }
      throw error;
    }

    const result = await getOrderDetail(organizationSlug, orderId);
    if (!result.ok) notFound();

    return (
      <OrderDetailClient
        organizationSlug={organizationSlug}
        callerRole={callerRole}
        initialOrder={result.data}
      />
    );
  }
  ```
  `requireOrgRole` is called directly from this Server Component (it only requires `server-only`, not a Server Action) so the page both gates access and learns the caller's exact role — needed to decide whether the closed-order panel renders the Reopen button.

- [ ] **Step 4: Rewrite `orders/[orderId]/order-detail-client.tsx` — status-driven panels**

  Full file:
  ```tsx
  "use client";

  import { useState } from "react";
  import { useRouter } from "next/navigation";
  import {
    getOrderDetail,
    confirmOrder,
    cancelOrder,
    closeOrder,
    reopenOrder,
  } from "@/features/orders/server/order-actions";
  import type { OrderWithItems } from "@/features/orders/types";
  import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, FALLBACK_LABELS } from "@/features/orders/types";
  import {
    formatPrice,
    formatWeight,
    computeLineTotal,
    weightWarnings,
    describeFallback,
  } from "@/features/orders/lib/order-model";
  import { Button } from "@/components/ui/button";
  import { Badge } from "@/components/ui/badge";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Textarea } from "@/components/ui/textarea";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { ArrowLeft } from "lucide-react";
  import { useToast } from "@/hooks/use-toast";

  type OrderDetailClientProps = {
    organizationSlug: string;
    callerRole: string;
    initialOrder: OrderWithItems | null;
  };

  export function OrderDetailClient({ organizationSlug, callerRole, initialOrder }: OrderDetailClientProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [order, setOrder] = useState(initialOrder);

    async function reloadOrder() {
      if (!order) return;
      const result = await getOrderDetail(organizationSlug, order.id);
      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }
      setOrder(result.data);
    }

    if (!order) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <p className="text-muted-foreground">Order not found</p>
          <Button variant="outline" onClick={() => router.push(`/${organizationSlug}/orders`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to orders
          </Button>
        </div>
      );
    }

    const formatDate = (date: string) =>
      new Date(date).toLocaleDateString("en-MY", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/${organizationSlug}/orders`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Order {order.id.slice(0, 8).toUpperCase()}</h1>
            <p className="text-muted-foreground">{order.customer?.name ?? "Unknown customer"}</p>
          </div>
          <Badge className={ORDER_STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
        </div>

        <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Zone</div>
            <div className="font-medium">{order.zone?.name ?? "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Delivery date</div>
            <div className="font-medium">{formatDate(order.delivery_date)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Truck</div>
            <div className="font-medium">
              {order.truck?.name ?? "-"} {order.truck?.code ? `(${order.truck.code})` : ""}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Address</div>
            <div className="font-medium">{order.delivery_address}</div>
          </div>
        </div>

        {order.notes && (
          <div className="rounded-lg border p-4">
            <h2 className="mb-2 font-semibold">Notes</h2>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{order.notes}</p>
          </div>
        )}

        {order.status === "pending" && (
          <PendingPanel order={order} organizationSlug={organizationSlug} onReload={reloadOrder} />
        )}
        {(order.status === "confirmed" || order.status === "ready") && (
          <ConfirmedReadyPanel order={order} organizationSlug={organizationSlug} onReload={reloadOrder} />
        )}
        {order.status === "delivered" && (
          <DeliveredPanel order={order} organizationSlug={organizationSlug} onReload={reloadOrder} />
        )}
        {order.status === "closed" && (
          <ClosedPanel
            order={order}
            callerRole={callerRole}
            organizationSlug={organizationSlug}
            onReload={reloadOrder}
          />
        )}
        {order.status === "cancelled" && (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">This order was cancelled.</div>
        )}
      </div>
    );
  }

  function CancelOrderDialog({
    organizationSlug,
    orderId,
    onReload,
    triggerLabel = "Cancel order",
  }: {
    organizationSlug: string;
    orderId: string;
    onReload: () => void;
    triggerLabel?: string;
  }) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function handleCancel() {
      setSubmitting(true);
      const result = await cancelOrder(organizationSlug, orderId, reason);
      setSubmitting(false);
      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: "Order cancelled" });
      setOpen(false);
      onReload();
    }

    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">{triggerLabel}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel order</DialogTitle>
            <DialogDescription>This cannot be undone. Let the team know why.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for cancelling" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button variant="destructive" disabled={submitting} onClick={handleCancel}>
              {submitting ? "Cancelling…" : "Confirm cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  function PendingPanel({
    order,
    organizationSlug,
    onReload,
  }: {
    order: OrderWithItems;
    organizationSlug: string;
    onReload: () => void;
  }) {
    const { toast } = useToast();
    const [availability, setAvailability] = useState<Record<string, boolean>>(() =>
      Object.fromEntries(order.items.map((item) => [item.id, true])),
    );
    const [confirming, setConfirming] = useState(false);

    async function handleConfirm() {
      setConfirming(true);
      const result = await confirmOrder({
        organizationSlug,
        orderId: order.id,
        decisions: order.items.map((item) => ({
          itemId: item.id,
          available: availability[item.id] ?? true,
        })),
      });
      setConfirming(false);
      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: "Order confirmed" });
      onReload();
    }

    return (
      <div className="space-y-6">
        <div className="space-y-3">
          {order.items.map((item) => {
            const available = availability[item.id] ?? true;
            return (
              <div key={item.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{item.product?.name ?? "Unknown product"}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`} · size{" "}
                      {item.size_min_kg}–{item.size_max_kg} kg
                    </div>
                    <div className="text-sm text-muted-foreground">If unavailable: {FALLBACK_LABELS[item.fallback]}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={available ? "default" : "outline"}
                      onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: true }))}
                    >
                      Available
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={!available ? "destructive" : "outline"}
                      onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: false }))}
                    >
                      Not available
                    </Button>
                  </div>
                </div>
                {!available && (
                  <Badge className="mt-3" variant={item.fallback === "cancel" ? "destructive" : "secondary"}>
                    Resulting fallback: {describeFallback(item.fallback)}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-3">
          <Button disabled={confirming} onClick={handleConfirm}>
            {confirming ? "Confirming…" : "Confirm order"}
          </Button>
          <CancelOrderDialog organizationSlug={organizationSlug} orderId={order.id} onReload={onReload} />
        </div>
      </div>
    );
  }

  function ConfirmedReadyPanel({
    order,
    organizationSlug,
    onReload,
  }: {
    order: OrderWithItems;
    organizationSlug: string;
    onReload: () => void;
  }) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Order lines</h2>
          <div className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span>
                  {item.product?.name ?? "Item"} —{" "}
                  {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`}
                </span>
                {item.is_cancelled ? (
                  <Badge variant="destructive">Cancelled</Badge>
                ) : item.fallback_applied ? (
                  <Badge variant="secondary">{describeFallback(item.fallback_applied)}</Badge>
                ) : (
                  <Badge variant="outline">As ordered</Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Warehouse task</h2>
          {(order.tasks ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No task recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {order.tasks!.map((task) => (
                <li key={task.id} className="flex items-center justify-between text-sm">
                  <span>{task.type === "allocate_weigh" ? "Allocate & weigh" : task.type}</span>
                  <Badge variant={task.status === "done" ? "secondary" : "outline"}>
                    {task.status === "done" ? "Done" : "Pending"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <CancelOrderDialog organizationSlug={organizationSlug} orderId={order.id} onReload={onReload} />
      </div>
    );
  }

  type SettlementDraft = { finalWeightKg: string; finalPieces: string; pricePerKg: string };

  function DeliveredPanel({
    order,
    organizationSlug,
    onReload,
  }: {
    order: OrderWithItems;
    organizationSlug: string;
    onReload: () => void;
  }) {
    const { toast } = useToast();
    const nonCancelled = order.items.filter((item) => !item.is_cancelled);
    const [drafts, setDrafts] = useState<Record<string, SettlementDraft>>(() =>
      Object.fromEntries(
        nonCancelled.map((item) => [
          item.id,
          {
            finalWeightKg: item.warehouse_weight_kg != null ? String(item.warehouse_weight_kg) : "",
            finalPieces: item.warehouse_pieces != null ? String(item.warehouse_pieces) : "",
            pricePerKg: "",
          },
        ]),
      ),
    );
    const [closing, setClosing] = useState(false);

    function updateDraft(itemId: string, field: keyof SettlementDraft, value: string) {
      setDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
    }

    function parseNum(value: string): number | null {
      if (value.trim() === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }

    const lines = nonCancelled.map((item) => {
      const draft = drafts[item.id] ?? { finalWeightKg: "", finalPieces: "", pricePerKg: "" };
      const finalWeightKg = parseNum(draft.finalWeightKg);
      const finalPieces = parseNum(draft.finalPieces);
      const pricePerKg = parseNum(draft.pricePerKg);
      const lineTotal = finalWeightKg != null && pricePerKg != null ? computeLineTotal(finalWeightKg, pricePerKg) : null;
      const warnings = weightWarnings({
        id: item.id,
        mode: item.mode,
        quantity: item.quantity,
        size_min_kg: item.size_min_kg,
        size_max_kg: item.size_max_kg,
        warehouse_weight_kg: item.warehouse_weight_kg,
        final_weight_kg: finalWeightKg,
        final_pieces: finalPieces,
        warehouse_pieces: item.warehouse_pieces,
      });
      return { item, draft, finalWeightKg, finalPieces, pricePerKg, lineTotal, warnings };
    });

    const runningTotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);

    async function handleClose() {
      const invalid = lines.find(
        (line) =>
          line.finalWeightKg == null || line.finalWeightKg <= 0 || line.pricePerKg == null || line.pricePerKg < 0,
      );
      if (invalid) {
        toast({
          title: "Error",
          description: `Enter a final weight and price per kg for ${invalid.item.product?.name ?? "every line"}.`,
          variant: "destructive",
        });
        return;
      }

      setClosing(true);
      const result = await closeOrder({
        organizationSlug,
        orderId: order.id,
        lines: lines.map((line) => ({
          itemId: line.item.id,
          finalWeightKg: line.finalWeightKg!,
          finalPieces: line.finalPieces ?? undefined,
          pricePerKg: line.pricePerKg!,
        })),
      });
      setClosing(false);

      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }

      toast({ title: "Order closed", description: `Total: ${formatPrice(result.data.total)}` });
      onReload();
    }

    return (
      <div className="space-y-4">
        {lines.map(({ item, draft, lineTotal, warnings }) => (
          <div key={item.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">{item.product?.name ?? "Unknown product"}</div>
                <div className="text-sm text-muted-foreground">
                  Warehouse: {item.warehouse_weight_kg != null ? formatWeight(item.warehouse_weight_kg) : "-"}
                  {item.warehouse_pieces != null ? ` · ${item.warehouse_pieces} pcs` : ""}
                </div>
              </div>
              <div className="text-right font-medium">{lineTotal != null ? formatPrice(lineTotal) : "—"}</div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Final weight (kg)</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={draft.finalWeightKg}
                  onChange={(e) => updateDraft(item.id, "finalWeightKg", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Final pieces</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={draft.finalPieces}
                  onChange={(e) => updateDraft(item.id, "finalPieces", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Price / kg</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={draft.pricePerKg}
                  onChange={(e) => updateDraft(item.id, "pricePerKg", e.target.value)}
                />
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="space-y-1">
                {warnings.map((warning) => (
                  <p key={warning.kind} className="rounded-md bg-amber-100 px-3 py-1.5 text-sm text-amber-800">
                    {warning.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="flex items-center justify-between rounded-lg border p-4">
          <span className="font-semibold">Running total</span>
          <span className="text-lg font-bold">{formatPrice(runningTotal)}</span>
        </div>

        <Button className="w-full" size="lg" disabled={closing} onClick={handleClose}>
          {closing ? "Closing…" : "Close order"}
        </Button>
      </div>
    );
  }

  function ClosedPanel({
    order,
    callerRole,
    organizationSlug,
    onReload,
  }: {
    order: OrderWithItems;
    callerRole: string;
    organizationSlug: string;
    onReload: () => void;
  }) {
    const { toast } = useToast();
    const [reopenOpen, setReopenOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const canReopen = callerRole === "owner" || callerRole === "org_admin";
    const nonCancelled = order.items.filter((item) => !item.is_cancelled);

    async function handleReopen() {
      setSubmitting(true);
      const result = await reopenOrder(organizationSlug, order.id, reason);
      setSubmitting(false);
      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: "Order reopened" });
      setReopenOpen(false);
      onReload();
    }

    return (
      <div className="space-y-6">
        <div className="rounded-lg border p-4">
          <h2 className="mb-3 font-semibold">Settlement summary</h2>
          <div className="space-y-2">
            {nonCancelled.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>
                  {item.product?.name ?? "Item"} —{" "}
                  {item.final_weight_kg != null ? formatWeight(item.final_weight_kg) : "-"} @{" "}
                  {item.price_per_kg != null ? formatPrice(item.price_per_kg) : "-"}/kg
                </span>
                <span className="font-medium">{item.line_total != null ? formatPrice(item.line_total) : "-"}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t pt-3 text-lg font-bold">
            <span>Total</span>
            <span>{formatPrice(order.total_amount)}</span>
          </div>
        </div>

        <div className="rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">Weight log</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Pieces</TableHead>
                <TableHead>Recorded at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order.weight_log ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No weight log entries
                  </TableCell>
                </TableRow>
              ) : (
                order.weight_log!.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="capitalize">{log.kind}</TableCell>
                    <TableCell>{formatWeight(log.weight_kg)}</TableCell>
                    <TableCell>{log.pieces ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(log.recorded_at).toLocaleString("en-MY")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {canReopen && (
          <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Reopen order</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reopen order</DialogTitle>
                <DialogDescription>
                  This reverts the order to delivered so settlement can be redone. The action is audit-logged.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why are you reopening this order?"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReopenOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={submitting} onClick={handleReopen}>
                  {submitting ? "Reopening…" : "Reopen"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5: Verify `orders/new/page.tsx` needs no change**

  Its current contents already match the props `NewOrderClient` still needs (`organizationSlug`, `organizationId`):
  ```tsx
  import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
  import { notFound } from "next/navigation";
  import { NewOrderClient } from "./new-order-client";

  export default async function NewOrderPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string }>;
  }) {
    const { organizationSlug } = await params;
    const org = await getOrganizationBySlug(organizationSlug);
    if (!org) notFound();

    return (
      <NewOrderClient
        organizationSlug={organizationSlug}
        organizationId={org.id}
      />
    );
  }
  ```
  No diff — leave the file untouched. This step exists only to record that it was checked, since Step 6 changes `NewOrderClient`'s internals but not its prop contract.

- [ ] **Step 6: Rewrite `orders/new/new-order-client.tsx` — manual order builder**

  Full file:
  ```tsx
  "use client";

  import { useEffect, useState } from "react";
  import { useRouter } from "next/navigation";
  import { createCustomer, searchCustomers, getCatalogForOrdering } from "@/features/seller/server/actions";
  import type { Customer } from "@/features/seller/types";
  import { getActiveZones } from "@/features/orders/server/portal-actions";
  import { getDeliveryOptionsForOrg, createManualOrder } from "@/features/orders/server/order-actions";
  import type { DeliveryOption, DeliveryZone, OrderFallback, OrderItemMode } from "@/features/orders/types";
  import { FALLBACKS, FALLBACK_LABELS } from "@/features/orders/types";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Textarea } from "@/components/ui/textarea";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { Plus, Search, Trash2 } from "lucide-react";
  import { useToast } from "@/hooks/use-toast";

  type CategoryWithProducts = Array<{
    id: string;
    name: string;
    products: Array<{ id: string; name: string }>;
  }>;

  type ProductOption = { id: string; name: string; categoryName: string };

  type LineDraft = {
    key: string;
    productId: string;
    mode: OrderItemMode;
    quantity: string;
    sizeMinKg: string;
    sizeMaxKg: string;
    fallback: OrderFallback;
  };

  let lineKeySeq = 0;
  function newLine(): LineDraft {
    lineKeySeq += 1;
    return {
      key: `line-${lineKeySeq}`,
      productId: "",
      mode: "piece",
      quantity: "1",
      sizeMinKg: "1",
      sizeMaxKg: "2",
      fallback: "mix",
    };
  }

  type NewOrderClientProps = {
    organizationSlug: string;
    organizationId: string;
  };

  export function NewOrderClient({ organizationSlug, organizationId }: NewOrderClientProps) {
    const { toast } = useToast();
    const router = useRouter();

    const [products, setProducts] = useState<ProductOption[]>([]);
    const [zones, setZones] = useState<DeliveryZone[]>([]);

    const [customerSearch, setCustomerSearch] = useState("");
    const [customerResults, setCustomerResults] = useState<Customer[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [newCustomerMode, setNewCustomerMode] = useState(false);
    const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "", notes: "" });

    const [lines, setLines] = useState<LineDraft[]>([newLine()]);

    const [zoneId, setZoneId] = useState("");
    const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
    const [selectedOptionKey, setSelectedOptionKey] = useState("");
    const [address, setAddress] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
      (async () => {
        const catalog = (await getCatalogForOrdering(organizationId)) as CategoryWithProducts;
        const flattened: ProductOption[] = catalog.flatMap((category) =>
          category.products.map((product) => ({
            id: product.id,
            name: product.name,
            categoryName: category.name,
          })),
        );
        setProducts(flattened);
      })();
      (async () => {
        const result = await getActiveZones(organizationSlug);
        if (result.ok) setZones(result.data);
      })();
    }, [organizationId, organizationSlug]);

    const handleCustomerSearch = async (query: string) => {
      setCustomerSearch(query);
      if (query.length < 2) {
        setCustomerResults([]);
        return;
      }
      try {
        const results = await searchCustomers(organizationId, query);
        setCustomerResults(results);
      } catch (error) {
        console.error(error);
      }
    };

    const handleAddNewCustomer = async () => {
      if (!newCustomer.name || !newCustomer.phone) {
        toast({ title: "Name and phone are required", variant: "destructive" });
        return;
      }
      try {
        const customer = await createCustomer(organizationId, {
          name: newCustomer.name,
          phone: newCustomer.phone,
          address: newCustomer.address || null,
          notes: newCustomer.notes || null,
        });
        setSelectedCustomer(customer);
        setNewCustomerMode(false);
        toast({ title: "Customer created" });
      } catch (error) {
        toast({ title: "Error", description: String(error), variant: "destructive" });
      }
    };

    const handleZoneChange = async (nextZoneId: string) => {
      setZoneId(nextZoneId);
      setSelectedOptionKey("");
      setDeliveryOptions([]);
      if (!nextZoneId) return;
      const result = await getDeliveryOptionsForOrg(organizationSlug, nextZoneId);
      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }
      setDeliveryOptions(result.data);
    };

    const addLine = () => setLines((prev) => [...prev, newLine()]);
    const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));
    const updateLine = (key: string, patch: Partial<LineDraft>) =>
      setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

    const selectedOption = deliveryOptions.find(
      (option) => `${option.slotId}-${option.date}` === selectedOptionKey,
    );

    const submitOrder = async () => {
      if (!selectedCustomer) {
        toast({ title: "Please select a customer", variant: "destructive" });
        return;
      }
      if (!zoneId || !selectedOption) {
        toast({ title: "Please pick a delivery zone and slot", variant: "destructive" });
        return;
      }
      if (!address.trim()) {
        toast({ title: "Please enter a delivery address", variant: "destructive" });
        return;
      }
      if (lines.length === 0 || lines.some((line) => !line.productId)) {
        toast({ title: "Please select a product for every line", variant: "destructive" });
        return;
      }
      for (const line of lines) {
        const quantity = Number(line.quantity);
        const sizeMinKg = Number(line.sizeMinKg);
        const sizeMaxKg = Number(line.sizeMaxKg);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          toast({ title: "Error", description: "Enter a valid quantity for every line.", variant: "destructive" });
          return;
        }
        if (line.mode === "piece" && !Number.isInteger(quantity)) {
          toast({ title: "Error", description: "Piece quantities must be whole numbers.", variant: "destructive" });
          return;
        }
        if (!Number.isFinite(sizeMinKg) || !Number.isFinite(sizeMaxKg) || sizeMinKg <= 0 || sizeMaxKg < sizeMinKg) {
          toast({ title: "Error", description: "Enter a valid size range for every line.", variant: "destructive" });
          return;
        }
      }

      const items = lines.map((line) => ({
        productId: line.productId,
        mode: line.mode,
        quantity: Number(line.quantity),
        sizeMinKg: Number(line.sizeMinKg),
        sizeMaxKg: Number(line.sizeMaxKg),
        fallback: line.fallback,
      }));

      setSubmitting(true);
      const result = await createManualOrder({
        organizationSlug,
        customerId: selectedCustomer.id,
        zoneId,
        slotId: selectedOption.slotId,
        deliveryDate: selectedOption.date,
        address,
        notes: notes || undefined,
        items,
      });
      setSubmitting(false);

      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }

      toast({ title: "Order created" });
      router.push(`/${organizationSlug}/orders/${result.data.orderId}`);
    };

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">New order</h1>
          <p className="text-muted-foreground">Create a manual order for a customer</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-lg border p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">Order lines</h2>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add line
                </Button>
              </div>
              <div className="space-y-4">
                {lines.map((line) => (
                  <div key={line.key} className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Product</Label>
                        <Select value={line.productId} onValueChange={(value) => updateLine(line.key, { productId: value })}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select product" />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.categoryName} · {product.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-5"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Mode</Label>
                        <Select
                          value={line.mode}
                          onValueChange={(value) => updateLine(line.key, { mode: value as OrderItemMode })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="piece">Piece</SelectItem>
                            <SelectItem value="kg">Kg</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          type="number"
                          step={line.mode === "piece" ? 1 : 0.1}
                          min={line.mode === "piece" ? 1 : 0.1}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Size min (kg)</Label>
                        <Input
                          type="number"
                          step={0.1}
                          min={0.1}
                          value={line.sizeMinKg}
                          onChange={(e) => updateLine(line.key, { sizeMinKg: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Size max (kg)</Label>
                        <Input
                          type="number"
                          step={0.1}
                          min={0.1}
                          value={line.sizeMaxKg}
                          onChange={(e) => updateLine(line.key, { sizeMaxKg: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">If size unavailable</Label>
                      <Select
                        value={line.fallback}
                        onValueChange={(value) => updateLine(line.key, { fallback: value as OrderFallback })}
                      >
                        <SelectTrigger className="w-full sm:w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FALLBACKS.map((fallback) => (
                            <SelectItem key={fallback} value={fallback}>
                              {FALLBACK_LABELS[fallback]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <h2 className="font-semibold">Delivery</h2>
              <div className="space-y-1">
                <Label className="text-xs">Zone</Label>
                <Select value={zoneId} onValueChange={handleZoneChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((zone) => (
                      <SelectItem key={zone.id} value={zone.id}>
                        {zone.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {zoneId && (
                <div className="space-y-1">
                  <Label className="text-xs">Delivery date &amp; slot</Label>
                  <Select value={selectedOptionKey} onValueChange={setSelectedOptionKey}>
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={deliveryOptions.length === 0 ? "No slots available" : "Select a date and slot"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {deliveryOptions.map((option) => (
                        <SelectItem key={`${option.slotId}-${option.date}`} value={`${option.slotId}-${option.date}`}>
                          {option.date} · {option.truckName} {option.startTime}–{option.endTime}
                          {option.remaining != null ? ` (${option.remaining} left)` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Delivery address</Label>
                <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order notes..." />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <h2 className="mb-4 font-semibold">Customer</h2>
              {!newCustomerMode ? (
                <>
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or phone..."
                      value={customerSearch}
                      onChange={(e) => handleCustomerSearch(e.target.value)}
                      className="pl-9"
                    />
                    {customerResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                        {customerResults.map((customer) => (
                          <button
                            key={customer.id}
                            type="button"
                            className="block w-full px-4 py-2 text-left hover:bg-muted"
                            onClick={() => {
                              setSelectedCustomer(customer);
                              setCustomerSearch("");
                              setCustomerResults([]);
                            }}
                          >
                            <div className="font-medium">{customer.name}</div>
                            <div className="text-sm text-muted-foreground">{customer.phone}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedCustomer && (
                    <div className="rounded-md bg-muted p-3">
                      <div className="font-medium">{selectedCustomer.name}</div>
                      <div className="text-sm text-muted-foreground">{selectedCustomer.phone}</div>
                      {selectedCustomer.address && (
                        <div className="text-sm text-muted-foreground">{selectedCustomer.address}</div>
                      )}
                    </div>
                  )}
                  <Button variant="outline" className="mt-2 w-full" onClick={() => setNewCustomerMode(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    New customer
                  </Button>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      value={newCustomer.name}
                      onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone *</Label>
                    <Input
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input
                      value={newCustomer.address}
                      onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={newCustomer.notes}
                      onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setNewCustomerMode(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddNewCustomer}>Save customer</Button>
                  </div>
                </div>
              )}
            </div>

            <Button className="w-full" size="lg" disabled={submitting} onClick={submitOrder}>
              {submitting ? "Creating…" : "Create order"}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 7: Typecheck and lint**

  Run:
  ```
  npm run typecheck
  npm run lint
  ```
  Expected: both exit 0 with no errors. `getCatalogForOrdering`'s return value is cast with `as CategoryWithProducts` since the function has no explicit return type annotation — if `npm run typecheck` reports the cast is unnecessary or unsafe, tighten `CategoryWithProducts` to match whatever shape `getCatalogForOrdering` actually infers rather than loosening the cast.

- [ ] **Step 8: Manual verification**

  With the dev server running (`npm run dev`) and signed in against `ayam-norliza-pilot`:
  1. As an `owner`/`org_admin`/`seller` member, open `/ayam-norliza-pilot/orders`. Confirm the "Pending" tab is active by default and its badge count matches the number of pending orders. Click "All", confirm every order reappears; click "Cancelled", confirm only cancelled orders show.
  2. Click a pending order row — confirm navigation to `/ayam-norliza-pilot/orders/<id>` and that each line card shows product name, mode+quantity, size range, and "If unavailable: <label>".
  3. Toggle "Not available" on one line — confirm a badge reading "Resulting fallback: <label>" appears (destructive-styled if that line's fallback is "cancel"). Click "Confirm order" — confirm a toast "Order confirmed" and the panel switches to the confirmed/ready view showing "As ordered" or the applied-fallback badge per line, plus a "Pending" warehouse task badge.
  4. Open an order in `delivered` status. Type a final weight far outside the warehouse weight (>20% deviation) — confirm an amber warning line appears live, and that the per-line total and running total update as you type weight/price. Click "Close order" — confirm the toast shows the formatted MYR total, and the panel becomes the closed summary + weight log table.
  5. As an `org_admin`, on that now-closed order click "Reopen order", enter a reason, confirm — verify toast "Order reopened" and the panel reverts to the delivered settlement form. Re-open a different closed order as a `seller` and confirm no "Reopen order" button renders.
  6. Go to `/ayam-norliza-pilot/orders/new`. Search and pick an existing customer (or create one), add a second order line with a different product/mode, pick a zone then a delivery date/slot from the populated dropdown, type an address, submit. Confirm redirect to the new order's detail page showing status "Pending".

- [ ] **Step 9: Commit**

  ```
  git add 'src/app/(seller)/[organizationSlug]/orders/page.tsx' 'src/app/(seller)/[organizationSlug]/orders/orders-client.tsx' 'src/app/(seller)/[organizationSlug]/orders/[orderId]/page.tsx' 'src/app/(seller)/[organizationSlug]/orders/[orderId]/order-detail-client.tsx' 'src/app/(seller)/[organizationSlug]/orders/new/new-order-client.tsx'
  git commit -m "$(cat <<'EOF'
  feat(seller): rewrite orders queue, detail, and manual order UI for pipeline v2
  EOF
  )"
  ```

---

### Task 13: Runs + manifest + staff tasks

**Files:**
- Create: `src/app/(seller)/[organizationSlug]/runs/page.tsx`
- Create: `src/app/(seller)/[organizationSlug]/runs/runs-client.tsx`
- Create: `src/app/(seller)/[organizationSlug]/runs/[runId]/manifest/print-button.tsx`
- Create: `src/app/(seller)/[organizationSlug]/runs/[runId]/manifest/page.tsx`
- Create: `src/app/(seller)/[organizationSlug]/tasks/page.tsx`
- Create: `src/app/(seller)/[organizationSlug]/tasks/tasks-client.tsx`

**Interfaces:**
Consumes (exact contract signatures):
```ts
// src/features/orders/server/order-actions.ts
getRuns(organizationSlug: string, date: string): Promise<ActionResult<RunWithOrders[]>>
setRunStatus(organizationSlug: string, runId: string, status: RunStatus): Promise<ActionResult>
getTodayTasks(organizationSlug: string): Promise<ActionResult<TaskWithOrder[]>>
completeTask(rawInput: unknown): Promise<ActionResult>
getRunManifest(organizationSlug: string, runId: string): Promise<ActionResult<RunWithOrders>>  // see CONTRACT CONCERN 1

// src/features/orders/server/guards.ts
requireOrgRole(organizationSlug: string, roles: readonly string[]): Promise<{ orgId: string; userId: string; role: string }>
class OrderPermissionError extends Error { readonly code = "forbidden" }

// src/features/orders/lib/roles.ts
STAFF_ROLES: readonly ["owner", "org_admin", "seller", "inventory", "logistics"]

// src/features/orders/lib/order-model.ts
formatPrice(amount: number): string
formatWeight(kg: number): string

// src/features/orders/types.ts
ORDER_STATUS_LABELS, ORDER_STATUS_COLORS: Record<OrderStatus, string>
type RunStatus = "planned" | "departed" | "completed"
type RunWithOrders = DeliveryRun & { truck?: Truck; orders: OrderWithItems[] }
type TaskWithOrder = OrderTask & { order: OrderWithItems }
```
Produces (route components):
```ts
// route: /${organizationSlug}/runs
export function RunsClient(props: { organizationSlug: string; initialDate: string; initialRuns: RunWithOrders[] }): JSX.Element

// route: /${organizationSlug}/runs/${runId}/manifest
export function PrintButton(): JSX.Element

// route: /${organizationSlug}/tasks
export function TasksClient(props: { organizationSlug: string; initialTasks: TaskWithOrder[] }): JSX.Element
```

---

- [ ] **Step 1: Create `runs/page.tsx` — fetch today's runs server-side**

  Full file:
  ```tsx
  import { getRuns } from "@/features/orders/server/order-actions";
  import { RunsClient } from "./runs-client";

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  export default async function RunsPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string }>;
  }) {
    const { organizationSlug } = await params;
    const date = todayIso();
    const result = await getRuns(organizationSlug, date);

    return (
      <RunsClient
        organizationSlug={organizationSlug}
        initialDate={date}
        initialRuns={result.ok ? result.data : []}
      />
    );
  }
  ```

- [ ] **Step 2: Create `runs/runs-client.tsx` — date picker, truck runs, status buttons, manifest link**

  Full file:
  ```tsx
  "use client";

  import { useState } from "react";
  import { useRouter } from "next/navigation";
  import { getRuns, setRunStatus } from "@/features/orders/server/order-actions";
  import type { RunWithOrders, RunStatus } from "@/features/orders/types";
  import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/features/orders/types";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Badge } from "@/components/ui/badge";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { useToast } from "@/hooks/use-toast";

  const RUN_STATUS_LABELS: Record<RunStatus, string> = {
    planned: "Planned",
    departed: "Departed",
    completed: "Completed",
  };

  const RUN_STATUS_COLORS: Record<RunStatus, string> = {
    planned: "bg-blue-100 text-blue-800",
    departed: "bg-yellow-100 text-yellow-800",
    completed: "bg-green-100 text-green-800",
  };

  type RunsClientProps = {
    organizationSlug: string;
    initialDate: string;
    initialRuns: RunWithOrders[];
  };

  export function RunsClient({ organizationSlug, initialDate, initialRuns }: RunsClientProps) {
    const { toast } = useToast();
    const router = useRouter();
    const [date, setDate] = useState(initialDate);
    const [runs, setRuns] = useState(initialRuns);
    const [loading, setLoading] = useState(false);

    async function loadRuns(nextDate: string) {
      setLoading(true);
      const result = await getRuns(organizationSlug, nextDate);
      setLoading(false);
      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }
      setRuns(result.data);
    }

    async function handleDateChange(nextDate: string) {
      setDate(nextDate);
      if (nextDate) await loadRuns(nextDate);
    }

    async function handleStatusChange(runId: string, status: "departed" | "completed") {
      const verb = status === "departed" ? "mark this run as departed" : "mark this run as completed";
      if (!window.confirm(`Are you sure you want to ${verb}?`)) return;
      const result = await setRunStatus(organizationSlug, runId, status);
      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: `Run marked ${status}` });
      await loadRuns(date);
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Delivery runs</h1>
            <p className="text-muted-foreground">Orders grouped by truck for a delivery date</p>
          </div>
          <Input type="date" value={date} onChange={(e) => handleDateChange(e.target.value)} className="w-40" />
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-muted-foreground">No runs scheduled for this date.</p>
        ) : (
          <div className="space-y-6">
            {runs.map((run) => (
              <div key={run.id} className="rounded-lg border">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {run.truck?.name ?? "Truck"} {run.truck?.code ? `(${run.truck.code})` : ""}
                    </div>
                    <Badge className={RUN_STATUS_COLORS[run.status]}>{RUN_STATUS_LABELS[run.status]}</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/${organizationSlug}/runs/${run.id}/manifest`)}
                    >
                      Manifest
                    </Button>
                    {run.status === "planned" && (
                      <Button size="sm" onClick={() => handleStatusChange(run.id, "departed")}>
                        Mark departed
                      </Button>
                    )}
                    {run.status !== "completed" && (
                      <Button size="sm" onClick={() => handleStatusChange(run.id, "completed")}>
                        Mark completed
                      </Button>
                    )}
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {run.orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>{order.customer?.name ?? "-"}</TableCell>
                        <TableCell>{order.zone?.name ?? "-"}</TableCell>
                        <TableCell className="max-w-xs truncate">{order.delivery_address}</TableCell>
                        <TableCell>{order.items.filter((i) => !i.is_cancelled).length} item(s)</TableCell>
                        <TableCell>
                          <Badge className={ORDER_STATUS_COLORS[order.status]}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  ```
  Legal `setRunStatus` transitions per the contract's RPC #5 are `planned→departed`, `departed→completed`, `planned→completed` — so "Mark departed" only shows for `planned` runs, and "Mark completed" shows whenever status is not already `completed`.

- [ ] **Step 3: Create `runs/[runId]/manifest/print-button.tsx` — client print trigger**

  Full file:
  ```tsx
  "use client";

  import { Button } from "@/components/ui/button";
  import { Printer } from "lucide-react";

  export function PrintButton() {
    return (
      <Button type="button" variant="outline" onClick={() => window.print()}>
        <Printer className="mr-2 h-4 w-4" />
        Print manifest
      </Button>
    );
  }
  ```

- [ ] **Step 4: Create `runs/[runId]/manifest/page.tsx` — printable manifest (server component)**

  Full file:
  ```tsx
  import { notFound } from "next/navigation";
  import { getRunManifest } from "@/features/orders/server/order-actions";
  import { ORDER_STATUS_LABELS } from "@/features/orders/types";
  import { formatWeight } from "@/features/orders/lib/order-model";
  import { PrintButton } from "./print-button";

  export default async function ManifestPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string; runId: string }>;
  }) {
    const { organizationSlug, runId } = await params;
    const result = await getRunManifest(organizationSlug, runId);
    if (!result.ok) notFound();
    const run = result.data;

    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between print:hidden">
          <div>
            <h1 className="text-xl font-bold">
              Manifest — {run.truck?.name ?? "Truck"} {run.truck?.code ? `(${run.truck.code})` : ""}
            </h1>
            <p className="text-muted-foreground">{run.run_date}</p>
          </div>
          <PrintButton />
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Order</th>
              <th className="p-2">Customer</th>
              <th className="p-2">Zone</th>
              <th className="p-2">Address</th>
              <th className="p-2">Items</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {run.orders.map((order) => (
              <tr key={order.id} className="border-b align-top">
                <td className="p-2 font-mono">{order.id.slice(0, 8)}</td>
                <td className="p-2">{order.customer?.name ?? "-"}</td>
                <td className="p-2">{order.zone?.name ?? "-"}</td>
                <td className="p-2">{order.delivery_address}</td>
                <td className="p-2">
                  <ul>
                    {order.items
                      .filter((item) => !item.is_cancelled)
                      .map((item) => (
                        <li key={item.id}>
                          {item.product?.name ?? "Item"} —{" "}
                          {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`}
                        </li>
                      ))}
                  </ul>
                </td>
                <td className="p-2">{ORDER_STATUS_LABELS[order.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  ```
  `print:hidden` is Tailwind's built-in `@media print` variant (core in Tailwind v4, no config needed) — it hides the header/button chrome only when the page is actually printed, leaving the plain table as the printed manifest.

- [ ] **Step 5: Create `tasks/page.tsx` — staff-gated daily task list**

  Full file:
  ```tsx
  import { redirect } from "next/navigation";
  import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
  import { STAFF_ROLES } from "@/features/orders/lib/roles";
  import { getTodayTasks } from "@/features/orders/server/order-actions";
  import { TasksClient } from "./tasks-client";

  export default async function TasksPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string }>;
  }) {
    const { organizationSlug } = await params;

    try {
      await requireOrgRole(organizationSlug, STAFF_ROLES);
    } catch (error) {
      if (error instanceof OrderPermissionError) {
        redirect(`/${organizationSlug}`);
      }
      throw error;
    }

    const result = await getTodayTasks(organizationSlug);

    return (
      <TasksClient organizationSlug={organizationSlug} initialTasks={result.ok ? result.data : []} />
    );
  }
  ```
  `STAFF_ROLES` includes `MANAGER_ROLES` (owner/org_admin/seller) plus `inventory`/`logistics`, so this gate admits both staff and managers, matching the contract's role table (staff can view daily tasks; managers can too since they can do everything staff can).

- [ ] **Step 6: Create `tasks/tasks-client.tsx` — task cards with weight/pieces inputs**

  Full file:
  ```tsx
  "use client";

  import { useState } from "react";
  import { completeTask } from "@/features/orders/server/order-actions";
  import type { TaskWithOrder } from "@/features/orders/types";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Badge } from "@/components/ui/badge";
  import { useToast } from "@/hooks/use-toast";

  type LineDraft = { weightKg: string; pieces: string };

  type TasksClientProps = {
    organizationSlug: string;
    initialTasks: TaskWithOrder[];
  };

  export function TasksClient({ organizationSlug, initialTasks }: TasksClientProps) {
    const { toast } = useToast();
    const [tasks, setTasks] = useState(initialTasks);
    const [drafts, setDrafts] = useState<Record<string, Record<string, LineDraft>>>(() =>
      Object.fromEntries(
        initialTasks.map((task) => [
          task.id,
          Object.fromEntries(
            task.order.items
              .filter((item) => !item.is_cancelled)
              .map((item) => [item.id, { weightKg: "", pieces: "" }]),
          ),
        ]),
      ),
    );
    const [submitting, setSubmitting] = useState<string | null>(null);

    function updateDraft(taskId: string, itemId: string, field: keyof LineDraft, value: string) {
      setDrafts((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          [itemId]: { ...prev[taskId][itemId], [field]: value },
        },
      }));
    }

    async function handleDone(task: TaskWithOrder) {
      const nonCancelled = task.order.items.filter((item) => !item.is_cancelled);
      const draft = drafts[task.id] ?? {};
      const weights: { itemId: string; weightKg: number; pieces?: number }[] = [];

      for (const item of nonCancelled) {
        const line = draft[item.id] ?? { weightKg: "", pieces: "" };
        const weightKg = Number(line.weightKg);
        if (!Number.isFinite(weightKg) || weightKg <= 0) {
          toast({
            title: "Error",
            description: `Enter a valid weight for ${item.product?.name ?? "an item"}.`,
            variant: "destructive",
          });
          return;
        }
        const entry: { itemId: string; weightKg: number; pieces?: number } = { itemId: item.id, weightKg };
        if (line.pieces.trim() !== "") {
          const pieces = Number(line.pieces);
          if (!Number.isFinite(pieces) || pieces <= 0 || !Number.isInteger(pieces)) {
            toast({
              title: "Error",
              description: `Enter a whole number of pieces for ${item.product?.name ?? "an item"}.`,
              variant: "destructive",
            });
            return;
          }
          entry.pieces = pieces;
        }
        weights.push(entry);
      }

      setSubmitting(task.id);
      const result = await completeTask({
        organizationSlug,
        taskId: task.id,
        weights,
      });
      setSubmitting(null);

      if (!result.ok) {
        toast({ title: "Error", description: result.message, variant: "destructive" });
        return;
      }

      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      toast({ title: "Task marked done" });
    }

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Today&apos;s tasks</h1>
          <p className="text-muted-foreground">Allocate and weigh orders for today&apos;s runs</p>
        </div>

        {tasks.length === 0 ? (
          <p className="text-muted-foreground">No tasks pending. Nice work.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {tasks.map((task) => (
              <div key={task.id} className="space-y-4 rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono text-sm text-muted-foreground">Order {task.order.id.slice(0, 8)}</div>
                    <div className="font-semibold">{task.order.customer?.name ?? "Unknown customer"}</div>
                  </div>
                  <Badge variant="secondary">{task.order.truck?.code ?? "-"}</Badge>
                </div>

                <div className="space-y-3">
                  {task.order.items
                    .filter((item) => !item.is_cancelled)
                    .map((item) => (
                      <div key={item.id} className="space-y-2 rounded-md bg-muted/50 p-3">
                        <div className="text-sm font-medium">{item.product?.name ?? "Unknown product"}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.mode === "kg" ? `${item.quantity} kg ordered` : `${item.quantity} pcs ordered`} · size{" "}
                          {item.size_min_kg}–{item.size_max_kg} kg
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            <Label className="text-xs">Weight (kg)</Label>
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={drafts[task.id]?.[item.id]?.weightKg ?? ""}
                              onChange={(e) => updateDraft(task.id, item.id, "weightKg", e.target.value)}
                            />
                          </div>
                          <div className="flex-1 space-y-1">
                            <Label className="text-xs">Pieces</Label>
                            <Input
                              type="number"
                              step="1"
                              min="0"
                              value={drafts[task.id]?.[item.id]?.pieces ?? ""}
                              onChange={(e) => updateDraft(task.id, item.id, "pieces", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                </div>

                <Button className="w-full" disabled={submitting === task.id} onClick={() => handleDone(task)}>
                  {submitting === task.id ? "Saving…" : "Done"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 7: Typecheck and lint**

  Run:
  ```
  npm run typecheck
  npm run lint
  ```
  Expected: both exit 0 with no errors.

- [ ] **Step 8: Manual verification**

  With the dev server running and signed in against `ayam-norliza-pilot`:
  1. As an `owner`/`org_admin`/`seller` member, open `/ayam-norliza-pilot/runs`. Confirm the date input defaults to today and any planned runs list their orders (customer, zone, address, items count, status).
  2. Click "Mark departed" on a planned run, accept the browser confirm dialog, confirm a toast and the run's badge flips to "Departed".
  3. Click "Mark completed" on that run, accept the confirm dialog — confirm the toast fires, then open one of that run's orders from `/ayam-norliza-pilot/orders` and verify its status is now "Delivered" (only orders that were "ready" flip; a run with a still-"confirmed" order leaves that order alone per the RPC).
  4. Click "Manifest" on a run — confirm the printable table (order/customer/zone/address/items/status) renders and clicking "Print manifest" opens the browser print dialog; the header and button should disappear in print preview (`print:hidden`).
  5. Sign in as an `inventory` or `logistics` staff member and open `/ayam-norliza-pilot/tasks`. Confirm cards show the short order id, customer name, and truck code, with a weight/pieces input pair per non-cancelled line.
  6. Enter a weight for every line on a card, click "Done" — confirm the card disappears and a "Task marked done" toast appears. Leave one line's weight blank on another card and click "Done" — confirm a destructive toast blocks submission instead of calling the server.
  7. Sign in as a member whose role is outside `STAFF_ROLES` (e.g. `veterinarian`) and navigate directly to `/ayam-norliza-pilot/tasks` — confirm it redirects to `/ayam-norliza-pilot` instead of rendering.

- [ ] **Step 9: Commit**

  ```
  git add 'src/app/(seller)/[organizationSlug]/runs/page.tsx' 'src/app/(seller)/[organizationSlug]/runs/runs-client.tsx' 'src/app/(seller)/[organizationSlug]/runs/[runId]/manifest/print-button.tsx' 'src/app/(seller)/[organizationSlug]/runs/[runId]/manifest/page.tsx' 'src/app/(seller)/[organizationSlug]/tasks/page.tsx' 'src/app/(seller)/[organizationSlug]/tasks/tasks-client.tsx'
  git commit -m "$(cat <<'EOF'
  feat(seller): add delivery runs, printable manifest, and staff tasks UI
  EOF
  )"
  ```

---

## CONTRACT CONCERNS

1. **`getRunManifest` signature is not spelled out in the contract.** The contract only says "`getDeliveryOptionsForOrg` and `getRunManifest` are produced by Task 8 - consume, do not redefine," without giving `getRunManifest`'s parameters or return type. Task 13's manifest page assumes `getRunManifest(organizationSlug: string, runId: string): Promise<ActionResult<RunWithOrders>>`, mirroring the `getOrderDetail(organizationSlug, orderId)` shape and reusing the `RunWithOrders` composite the contract already defines for exactly this purpose. If Task 8 lands with a different signature, `runs/[runId]/manifest/page.tsx` needs a one-line call-site fix.

2. **No `requireOrgRole`-with-redirect helper exists in the contract's `guards.ts`.** The assignment text for Task 13 says "`requireRoleOrRedirect` STAFF_ROLES," but the contract only exports the throwing `requireOrgRole`. `orders/[orderId]/page.tsx` and `tasks/page.tsx` both build the redirect behavior inline (`try { await requireOrgRole(...) } catch (e) { if (e instanceof OrderPermissionError) redirect(...) }`) rather than assuming a convenience wrapper exists. If a shared `requireOrgRoleOrRedirect` helper is added to `guards.ts` later, these two call sites are the ones to simplify.

3. **Numeric row-type assumption.** These UI tasks write arithmetic directly against `OrderItem`/`Order`/`OrderWeightLog` numeric fields (`quantity`, `size_min_kg`, `size_max_kg`, `warehouse_weight_kg`, `warehouse_pieces`, `final_weight_kg`, `final_pieces`, `price_per_kg`, `line_total`, `total_amount`, `weight_kg`) as plain `number | null`, not the raw string Supabase normally returns for Postgres `numeric` columns. This is inferred from the contract's own `computeLineTotal(finalWeightKg: number, pricePerKg: number)` and `computeOrderTotal(lines: Array<{ final_weight_kg: number | null; price_per_kg: number | null; ... }>)` signatures, which only type-check if the row types already carry `number`. Whichever task defines `src/features/orders/types.ts` must construct/convert these fields to JS numbers when building `Order`/`OrderItem`/`OrderWeightLog` (not just alias the raw generated DB row), or every numeric access in this section's code needs a wrapping `Number(...)`.

4. **`getActiveZones` (portal-actions.ts, public read, no role check) is reused for the manager's manual-order zone dropdown** in `orders/new/new-order-client.tsx`, since the contract lists no manager-specific "list zones" action and `getActiveZones` is explicitly public. This is safe (it only returns zone names/order, gated by RLS `is_active = true`), but if a `MANAGER_ROLES`-gated equivalent is later added to `order-actions.ts` for consistency with the rest of the manager surface, swap the import.
### Task 14: E2E pipeline specs

**Prerequisite:** Tasks 1-13 complete. All routes, RPCs, and server actions described in the contract exist, so every spec below is expected to run **green on first execution** — there is no red/implementation/green loop for this task the way there is for unit tests, because the code under test was written by earlier tasks. Each step below is: write the spec → run it → confirm the reported PASS output.

**Files:**
Modify: `e2e/_fixtures.ts` (add `BUYER` + `signInBuyer`)
Create: `e2e/order-pipeline.spec.ts`
Create: `e2e/buyer-order.spec.ts`

**Interfaces:**
Consumes: `OWNER`, `signIn(page, email, password)` from `e2e/_fixtures.ts`; the pilot org's seeded `delivery_zones` named `Zone 1`/`Zone 2`/`Zone 3` and `delivery_slots` (migration 3); seller routes `/ayam-norliza-pilot/products`, `/orders`, `/orders/new`, `/orders/[orderId]`, `/tasks`, `/runs`; buyer routes `/buyer_portal/ayam-norliza-pilot/{login,shop,cart,checkout,orders,orders/[orderId]}`; server actions `createManualOrder`, `confirmOrder`, `completeTask`, `setRunStatus`, `closeOrder`, `placeOrder`, `cancelMyOrder`, `getTodayTasks` (contract §"Server actions").
Produces: `BUYER` and `signInBuyer(page, email, password)` exported from `e2e/_fixtures.ts` for reuse by any future buyer-portal spec.

This task necessarily commits to specific accessible names (button/label text) for the new order-pipeline screens that Tasks 9-13 implement, since the contract does not print literal UI copy for most of them. Every such name used below is either quoted directly from the contract/spec doc, reused verbatim from an existing, non-rewritten component, or a documented assumption — see **CONTRACT CONCERN #2** at the end of this file for the full list and what to do if a Task 9-13 implementation used different wording.

- [ ] Add `BUYER` and `signInBuyer` to `e2e/_fixtures.ts`

  Current file (`e2e/_fixtures.ts`, read in full):
  ```ts
  import { test, expect, type Page } from "@playwright/test";

  /**
   * Resend mock + owner fixtures. Tests sign in by going through the real
   * `/login` form; set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD when running
   * against a non-local Supabase project.
   */

  export const OWNER = {
    email: process.env.E2E_OWNER_EMAIL ?? "owner@ayam-norliza-pilot.example",
    password: process.env.E2E_OWNER_PASSWORD ?? "test-only-password-12-chars",
  };

  export async function signIn(page: Page, email: string, password: string) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/(?:[^/]+\/settings\/organization|signup)(?:[/?#]|$)/, { timeout: 10_000 });
  }

  export async function expectOnDashboard(page: Page) {
    await expect(page).toHaveURL(/\/(?:ayam-norliza-pilot|.*)\//);
  }
  ```

  Edit hunk — insert `BUYER` and `signInBuyer` between `signIn` and `expectOnDashboard`:
  ```diff
     export async function signIn(page: Page, email: string, password: string) {
       await page.goto("/login");
       await page.getByLabel(/email/i).fill(email);
       await page.getByLabel(/password/i).fill(password);
       await page.getByRole("button", { name: /sign in/i }).click();
       await expect(page).toHaveURL(/\/(?:[^/]+\/settings\/organization|signup)(?:[/?#]|$)/, { timeout: 10_000 });
     }

  +  export const BUYER = {
  +    email: process.env.E2E_BUYER_EMAIL ?? "buyer@ayam-norliza-pilot.example",
  +    password: process.env.E2E_BUYER_PASSWORD ?? "test-only-password-12-chars",
  +  };
  +
  +  export async function signInBuyer(page: Page, email: string, password: string) {
  +    await page.goto("/buyer_portal/ayam-norliza-pilot/login");
  +    await page.getByLabel(/email/i).fill(email);
  +    await page.getByLabel(/password/i).fill(password);
  +    await page.getByRole("button", { name: /sign in/i }).click();
  +    await expect(page).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, { timeout: 10_000 });
  +  }
  +
     export async function expectOnDashboard(page: Page) {
       await expect(page).toHaveURL(/\/(?:ayam-norliza-pilot|.*)\//);
     }
  ```

  Resulting full file:
  ```ts
  import { test, expect, type Page } from "@playwright/test";

  /**
   * Resend mock + owner fixtures. Tests sign in by going through the real
   * `/login` form; set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD when running
   * against a non-local Supabase project.
   */

  export const OWNER = {
    email: process.env.E2E_OWNER_EMAIL ?? "owner@ayam-norliza-pilot.example",
    password: process.env.E2E_OWNER_PASSWORD ?? "test-only-password-12-chars",
  };

  export async function signIn(page: Page, email: string, password: string) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/(?:[^/]+\/settings\/organization|signup)(?:[/?#]|$)/, { timeout: 10_000 });
  }

  export const BUYER = {
    email: process.env.E2E_BUYER_EMAIL ?? "buyer@ayam-norliza-pilot.example",
    password: process.env.E2E_BUYER_PASSWORD ?? "test-only-password-12-chars",
  };

  export async function signInBuyer(page: Page, email: string, password: string) {
    await page.goto("/buyer_portal/ayam-norliza-pilot/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, { timeout: 10_000 });
  }

  export async function expectOnDashboard(page: Page) {
    await expect(page).toHaveURL(/\/(?:ayam-norliza-pilot|.*)\//);
  }
  ```
  This matches the buyer login page's real form fields (`src/app/buyer_portal/[organizationSlug]/login/page.tsx`): `<Label htmlFor="login-email">Email</Label>` / `<Label htmlFor="login-password">Password</Label>` / `<Button type="submit">Sign In</Button>`, and its success redirect `router.push(\`/buyer_portal/${organizationSlug}/shop\`)`.

- [ ] Create `e2e/order-pipeline.spec.ts`

  Full file:
  ```ts
  import { expect, test, type Page } from "@playwright/test";
  import { OWNER, signIn } from "./_fixtures";

  // Creates a category + product + one available "Standard" variant via the
  // existing (unchanged by this plan) seller Products screen, so the order
  // pipeline has something sellable to order. `productName` also becomes the
  // category name (suffixed) so each test's fixtures are self-contained and
  // never collide with another test's.
  async function createSellableProduct(page: Page, productName: string) {
    await page.goto("/ayam-norliza-pilot/products");
    await page.getByRole("button", { name: "Add Category" }).click();
    await page.getByLabel("Category Name").fill(`${productName} Category`);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    await page.getByRole("button", { name: "Add Product" }).click();
    await page.getByLabel("Product Name").fill(productName);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: `${productName} Category` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    await page.getByRole("button", { name: "Add Size/Option" }).click();
    await page.getByLabel(/name \(e\.g\., standard/i).fill("Standard");
    await page.getByLabel(/price/i).fill("12.00");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
  }

  // Reads the ISO date (YYYY-MM-DD) out of the first offered delivery option
  // so it can be re-entered on the /runs date picker later in the same test.
  async function pickFirstDeliveryOption(page: Page): Promise<string> {
    const firstOption = page.getByRole("radio").first();
    await expect(firstOption).toBeVisible({ timeout: 10_000 });
    const label = await firstOption.evaluate(
      (el) => el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? "",
    );
    const match = label.match(/\d{4}-\d{2}-\d{2}/);
    if (!match) {
      throw new Error(`Could not read an ISO delivery date out of option label: "${label}"`);
    }
    await firstOption.check();
    return match[0];
  }

  test("owner creates a manual order, confirms with a fallback, and takes it through to close", async ({
    page,
  }) => {
    await signIn(page, OWNER.email, OWNER.password);
    await createSellableProduct(page, "E2E Pipeline Chicken");

    // --- Create the manual order ---
    await page.goto("/ayam-norliza-pilot/orders/new");
    await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /new customer/i }).click();
    await page.getByLabel(/name \*/i).fill("E2E Pipeline Customer");
    await page.getByLabel(/phone \*/i).fill("0123456789");
    await page.getByRole("button", { name: /save customer/i }).click();
    await expect(page.getByText("E2E Pipeline Customer")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("combobox", { name: /select product/i }).click();
    await page.getByRole("option", { name: "E2E Pipeline Chicken" }).click();
    await page.getByRole("radio", { name: "Kg" }).check();
    await page.getByLabel("Quantity").fill("5");
    await page.getByLabel("Min size (kg)").fill("1.5");
    await page.getByLabel("Max size (kg)").fill("1.8");
    await page.getByRole("radio", { name: "Mix sizes" }).check();
    await page.getByRole("button", { name: /add item/i }).click();

    await page.getByRole("combobox", { name: /select zone/i }).click();
    await page.getByRole("option", { name: "Zone 1" }).click();
    await page.getByLabel(/delivery address/i).fill("12 Jalan Uji, Kuala Lumpur");
    const deliveryDate = await pickFirstDeliveryOption(page);

    await page.getByRole("button", { name: /create order/i }).click();
    await expect(page).toHaveURL(/\/ayam-norliza-pilot\/orders/, { timeout: 10_000 });

    // --- Confirm, applying the pre-declared fallback on the one line ---
    const row = page.getByRole("row", { name: /e2e pipeline customer/i });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "View" }).click();
    await expect(page.getByRole("heading", { name: /order details/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "No" }).click();
    await expect(page.getByText("Mix sizes")).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(
      page.locator('[data-slot="badge"]').filter({ hasText: "Confirmed" }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // --- Warehouse completes the allocate/weigh task ---
    // NOTE: this step assumes getTodayTasks includes orders due tomorrow, not
    // only orders due strictly today — see CONTRACT CONCERN #1 below.
    await page.goto("/ayam-norliza-pilot/tasks");
    await expect(page.getByRole("heading", { name: /tasks/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("E2E Pipeline Customer")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel(/warehouse weight/i).fill("5.2");
    await page.getByLabel(/warehouse pieces/i).fill("3");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("E2E Pipeline Customer")).toBeHidden({ timeout: 10_000 });

    // --- Run departs, then returns ---
    await page.goto("/ayam-norliza-pilot/runs");
    await expect(page.getByRole("heading", { name: /runs/i })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel(/date/i).fill(deliveryDate);
    await expect(page.getByText("E2E Pipeline Customer")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /mark departed/i }).click();
    await expect(page.getByText(/departed/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /truck returned/i }).click();
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });

    // --- Close with final weights and today's price ---
    await page.goto("/ayam-norliza-pilot/orders");
    await page.getByRole("tab", { name: /delivered/i }).click();
    const deliveredRow = page.getByRole("row", { name: /e2e pipeline customer/i });
    await expect(deliveredRow).toBeVisible({ timeout: 10_000 });
    await deliveredRow.getByRole("button", { name: "View" }).click();

    await page.getByLabel(/final weight/i).fill("5.4");
    await page.getByLabel(/final pieces/i).fill("3");
    await page.getByLabel(/price per kg/i).fill("12.50");
    await page.getByRole("button", { name: "Close" }).click();

    await expect(
      page.locator('[data-slot="badge"]').filter({ hasText: "Closed" }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/67\.50/).first()).toBeVisible();
  });

  test("fallback = cancel cancels the order when the only line is unavailable at confirm", async ({
    page,
  }) => {
    await signIn(page, OWNER.email, OWNER.password);
    await createSellableProduct(page, "E2E Cancel Fallback Chicken");

    await page.goto("/ayam-norliza-pilot/orders/new");
    await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /new customer/i }).click();
    await page.getByLabel(/name \*/i).fill("E2E Cancel Customer");
    await page.getByLabel(/phone \*/i).fill("0123456780");
    await page.getByRole("button", { name: /save customer/i }).click();
    await expect(page.getByText("E2E Cancel Customer")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("combobox", { name: /select product/i }).click();
    await page.getByRole("option", { name: "E2E Cancel Fallback Chicken" }).click();
    await page.getByRole("radio", { name: "Piece" }).check();
    await page.getByLabel("Quantity").fill("4");
    await page.getByLabel("Min size (kg)").fill("1.4");
    await page.getByLabel("Max size (kg)").fill("1.6");
    await page.getByRole("radio", { name: "Cancel my order" }).check();
    await page.getByRole("button", { name: /add item/i }).click();

    await page.getByRole("combobox", { name: /select zone/i }).click();
    await page.getByRole("option", { name: "Zone 1" }).click();
    await page.getByLabel(/delivery address/i).fill("9 Jalan Uji, Kuala Lumpur");
    await pickFirstDeliveryOption(page);

    await page.getByRole("button", { name: /create order/i }).click();
    await expect(page).toHaveURL(/\/ayam-norliza-pilot\/orders/, { timeout: 10_000 });

    const row = page.getByRole("row", { name: /e2e cancel customer/i });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "View" }).click();
    await expect(page.getByRole("heading", { name: /order details/i })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "No" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.locator('[data-slot="badge"]').filter({ hasText: "Cancelled" }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
  ```

  Note the second test discards `pickFirstDeliveryOption`'s return value on purpose — it never visits `/runs`, so it has no need for the chosen date.

  Run it:
  ```bash
  npx playwright test e2e/order-pipeline.spec.ts
  ```
  Expected output (2 tests × 2 configured projects — `chromium` and `tablet` — in `playwright.config.ts`):
  ```
  Running 4 tests using 1 worker

    ✓  1 [chromium] › order-pipeline.spec.ts:44:3 › owner creates a manual order, confirms with a fallback, and takes it through to close (12.1s)
    ✓  2 [chromium] › order-pipeline.spec.ts:118:3 › fallback = cancel cancels the order when the only line is unavailable at confirm (5.8s)
    ✓  3 [tablet] › order-pipeline.spec.ts:44:3 › owner creates a manual order, confirms with a fallback, and takes it through to close (12.4s)
    ✓  4 [tablet] › order-pipeline.spec.ts:118:3 › fallback = cancel cancels the order when the only line is unavailable at confirm (5.9s)

    4 passed (38.7s)
  ```

- [ ] Create `e2e/buyer-order.spec.ts`

  Full file:
  ```ts
  import { expect, test, type Page } from "@playwright/test";
  import { OWNER, BUYER, signIn, signInBuyer } from "./_fixtures";

  async function createSellableProduct(page: Page, productName: string) {
    await page.goto("/ayam-norliza-pilot/products");
    await page.getByRole("button", { name: "Add Category" }).click();
    await page.getByLabel("Category Name").fill(`${productName} Category`);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    await page.getByRole("button", { name: "Add Product" }).click();
    await page.getByLabel("Product Name").fill(productName);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: `${productName} Category` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    await page.getByRole("button", { name: "Add Size/Option" }).click();
    await page.getByLabel(/name \(e\.g\., standard/i).fill("Standard");
    await page.getByLabel(/price/i).fill("15.00");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
  }

  test("buyer adds a product with a size range and fallback, checks out, and sees the order as Pending", async ({
    page,
    context,
  }) => {
    // Seed a sellable product as the owner in the main tab.
    await signIn(page, OWNER.email, OWNER.password);
    await createSellableProduct(page, "E2E Buyer Portal Chicken");

    // Shop as the buyer in a second tab (same pattern as e2e/deactivation.spec.ts).
    const buyerPage = await context.newPage();
    await signInBuyer(buyerPage, BUYER.email, BUYER.password);

    const productCard = buyerPage
      .locator('[data-slot="card"]')
      .filter({ hasText: "E2E Buyer Portal Chicken" });
    await expect(productCard).toBeVisible({ timeout: 10_000 });
    await productCard.getByRole("button", { name: /add to cart/i }).click();

    const addToCartDialog = buyerPage.getByRole("dialog");
    await expect(addToCartDialog).toBeVisible({ timeout: 10_000 });
    await addToCartDialog.getByRole("radio", { name: "Kg" }).check();
    await addToCartDialog.getByLabel("Quantity").fill("2.5");
    await addToCartDialog.getByLabel("Min size (kg)").fill("1.3");
    await addToCartDialog.getByLabel("Max size (kg)").fill("1.6");
    await addToCartDialog.getByRole("radio", { name: "Bigger is ok" }).check();
    await addToCartDialog.getByRole("button", { name: /add to cart/i }).click();
    await expect(addToCartDialog).toBeHidden({ timeout: 10_000 });

    await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
    await expect(buyerPage.getByText("E2E Buyer Portal Chicken")).toBeVisible({ timeout: 10_000 });
    await buyerPage.getByRole("button", { name: /proceed to checkout/i }).click();
    await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
      timeout: 10_000,
    });

    await buyerPage.getByRole("combobox", { name: /select zone/i }).click();
    await buyerPage.getByRole("option", { name: "Zone 1" }).click();
    await buyerPage.getByLabel(/delivery address/i).fill("77 Jalan Pembeli, Kuala Lumpur");
    const firstOption = buyerPage.getByRole("radio").first();
    await expect(firstOption).toBeVisible({ timeout: 10_000 });
    await firstOption.check();
    await buyerPage.getByRole("button", { name: /place order/i }).click();

    await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/orders/, {
      timeout: 10_000,
    });
    await expect(
      buyerPage.locator('[data-slot="badge"]').filter({ hasText: "Pending" }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("buyer cancels a pending order", async ({ page, context }) => {
    await signIn(page, OWNER.email, OWNER.password);
    await createSellableProduct(page, "E2E Buyer Cancel Chicken");

    const buyerPage = await context.newPage();
    await signInBuyer(buyerPage, BUYER.email, BUYER.password);

    const productCard = buyerPage
      .locator('[data-slot="card"]')
      .filter({ hasText: "E2E Buyer Cancel Chicken" });
    await expect(productCard).toBeVisible({ timeout: 10_000 });
    await productCard.getByRole("button", { name: /add to cart/i }).click();

    const addToCartDialog = buyerPage.getByRole("dialog");
    await expect(addToCartDialog).toBeVisible({ timeout: 10_000 });
    await addToCartDialog.getByRole("radio", { name: "Piece" }).check();
    await addToCartDialog.getByLabel("Quantity").fill("2");
    await addToCartDialog.getByLabel("Min size (kg)").fill("1.2");
    await addToCartDialog.getByLabel("Max size (kg)").fill("1.5");
    await addToCartDialog.getByRole("radio", { name: "Cancel my order" }).check();
    await addToCartDialog.getByRole("button", { name: /add to cart/i }).click();
    await expect(addToCartDialog).toBeHidden({ timeout: 10_000 });

    await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
    await buyerPage.getByRole("button", { name: /proceed to checkout/i }).click();
    await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
      timeout: 10_000,
    });

    await buyerPage.getByRole("combobox", { name: /select zone/i }).click();
    await buyerPage.getByRole("option", { name: "Zone 1" }).click();
    await buyerPage.getByLabel(/delivery address/i).fill("21 Jalan Batal, Kuala Lumpur");
    const firstOption = buyerPage.getByRole("radio").first();
    await expect(firstOption).toBeVisible({ timeout: 10_000 });
    await firstOption.check();
    await buyerPage.getByRole("button", { name: /place order/i }).click();
    await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/orders/, {
      timeout: 10_000,
    });

    // getMyOrders sorts newest first, so the order just placed is the first
    // card — there may be an older order from the previous test for the same
    // seeded buyer account still sitting in the list.
    await buyerPage.getByRole("link", { name: /view details/i }).first().click();
    await expect(buyerPage.getByRole("heading", { name: /order details/i })).toBeVisible({
      timeout: 10_000,
    });
    await buyerPage.getByRole("button", { name: /cancel order/i }).click();
    await expect(
      buyerPage.locator('[data-slot="badge"]').filter({ hasText: "Cancelled" }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
  ```

  Run it:
  ```bash
  npx playwright test e2e/buyer-order.spec.ts
  ```
  Expected output:
  ```
  Running 4 tests using 1 worker

    ✓  1 [chromium] › buyer-order.spec.ts:16:3 › buyer adds a product with a size range and fallback, checks out, and sees the order as Pending (9.6s)
    ✓  2 [chromium] › buyer-order.spec.ts:74:3 › buyer cancels a pending order (7.3s)
    ✓  3 [tablet] › buyer-order.spec.ts:16:3 › buyer adds a product with a size range and fallback, checks out, and sees the order as Pending (9.9s)
    ✓  4 [tablet] › buyer-order.spec.ts:74:3 › buyer cancels a pending order (7.5s)

    4 passed (34.3s)
  ```

- [ ] Run the full suite once to confirm nothing else regressed
  ```bash
  npm run test:e2e
  ```
  Expected: every spec in `e2e/` passes, including the two new files (`N passed`, no failures — `N` is whatever the full suite total is once these two files are added to the existing eight).

- [ ] Commit
  ```bash
  git add e2e/_fixtures.ts e2e/order-pipeline.spec.ts e2e/buyer-order.spec.ts
  git commit -m "$(cat <<'EOF'
  test(e2e): add order pipeline and buyer portal E2E specs

  Covers manual order → confirm (with fallback) → warehouse task → run →
  close, the fallback=cancel short-circuit, and the buyer checkout +
  cancel-while-pending path against the new order pipeline.
  EOF
  )"
  ```

---

### Task 15: Cleanup old order code

**Files:**
Modify: `src/features/buyer/server/actions.ts`
Modify: `src/features/buyer/types.ts`
Modify: `src/features/seller/server/actions.ts`
Modify: `src/features/seller/types.ts`

**Interfaces:**
Consumes: nothing new — this task only removes code superseded by `src/features/orders/*` (Tasks 6-13) and the buyer portal / seller UI rewrites (Tasks 10-13), which by this point no longer import any of the symbols deleted here.
Produces: nothing downstream depends on this task; it is terminal. The five full-suite gates at the end are the acceptance criteria for the whole order-module plan (Tasks 1-15).

Two of the new module's exports intentionally reuse names from the old modules being cleaned up here (`src/features/orders/types.ts` also exports `Order`, `OrderItem`, `OrderStatus`, `ORDER_STATUSES`, `ORDER_STATUS_LABELS`, `OrderWithItems` — see contract §"types.ts — exact exports"). Every grep below that touches one of those overlapping names is deliberately scoped to files importing from the **old** module path, so it isn't tripped up by the new module's legitimate, identically-named exports. Do not replace these with a plain repo-wide grep for the bare name — see **CONTRACT CONCERN #3**.

- [ ] Edit `src/features/buyer/server/actions.ts` — drop the order functions and their now-unused imports

  Read first (already read in full above — 391 lines). Two hunks:

  Hunk 1 — imports (`revalidatePath` and the order-only types become unused once the functions below are gone):
  ```diff
   "use server";

  -import { revalidatePath } from "next/cache";
   import { z } from "zod";
   import { createSupabaseServerClient } from "@/lib/supabase/server";
   import type { ActionResult } from "@/features/identity-access/server/actions";
   import type {
     Buyer,
  -  BuyerOrder,
  -  BuyerOrderItem,
     Category,
     Product,
     ProductVariant,
     CatalogWithProducts,
  -  OrderWithItems,
  -  CartItem,
   } from "../types";
  ```

  Hunk 2 — delete the entire "Order actions" section (everything from that section's comment header through the end of the file — `getBuyerOrders`, `getBuyerOrderWithItems`, the `CreateOrderInput` schema, and `createBuyerOrder`):
  ```diff
     return ok(buyer as Buyer);
   }
  -
  -// ---------------------------------------------------------------------------
  -// Order actions
  -// ---------------------------------------------------------------------------
  -
  -export async function getBuyerOrders(): Promise<ActionResult<BuyerOrder[]>> {
  -  const supabase = await createSupabaseServerClient();
  -
  -  const {
  -    data: { user },
  -  } = await supabase.auth.getUser();
  -  if (!user) {
  -    return err("unauthenticated", "Not authenticated");
  -  }
  -
  -  const { data: orders, error } = await supabase
  -    .from("buyer_orders")
  -    .select("*")
  -    .eq("buyer_id", user.id)
  -    .order("created_at", { ascending: false });
  -
  -  if (error) {
  -    return err("internal", "Failed to fetch orders");
  -  }
  -
  -  return ok((orders ?? []) as BuyerOrder[]);
  -}
  -
  -export async function getBuyerOrderWithItems(
  -  orderId: string,
  -): Promise<ActionResult<OrderWithItems>> {
  -  const supabase = await createSupabaseServerClient();
  -
  -  const {
  -    data: { user },
  -  } = await supabase.auth.getUser();
  -  if (!user) {
  -    return err("unauthenticated", "Not authenticated");
  -  }
  -
  -  const { data: order, error } = await supabase
  -    .from("buyer_orders")
  -    .select("*")
  -    .eq("id", orderId)
  -    .eq("buyer_id", user.id)
  -    .single();
  -
  -  if (error || !order) {
  -    return err("not_found", "Order not found");
  -  }
  -
  -  const { data: items } = await supabase
  -    .from("buyer_order_items")
  -    .select(
  -      `
  -      *,
  -      variant:product_variants(
  -        *,
  -        product:products(*)
  -      )
  -    `,
  -    )
  -    .eq("order_id", orderId);
  -
  -  return ok({
  -    ...order,
  -    items: (items ?? []) as OrderWithItems["items"],
  -  } as OrderWithItems);
  -}
  -
  -const CreateOrderInput = z.object({
  -  items: z
  -    .array(
  -      z.object({
  -        variantId: z.string().uuid(),
  -        quantity: z.number().positive().max(10000),
  -      }),
  -    )
  -    .min(1),
  -  deliveryAddress: z.string().max(500).optional(),
  -  notes: z.string().max(1000).optional(),
  -});
  -
  -export async function createBuyerOrder(
  -  rawInput: unknown,
  -): Promise<ActionResult<BuyerOrder>> {
  -  const parsed = CreateOrderInput.safeParse(rawInput);
  -  if (!parsed.success) {
  -    return err("validation", "Invalid order data");
  -  }
  -  const input = parsed.data;
  -
  -  const supabase = await createSupabaseServerClient();
  -
  -  const {
  -    data: { user },
  -  } = await supabase.auth.getUser();
  -  if (!user) {
  -    return err("unauthenticated", "Not authenticated");
  -  }
  -
  -  // Get buyer record to find organization
  -  const { data: buyer, error: buyerError } = await supabase
  -    .from("buyers")
  -    .select("id, organization_id, address")
  -    .eq("id", user.id)
  -    .single();
  -
  -  if (buyerError || !buyer) {
  -    return err("validation", "Buyer not found");
  -  }
  -
  -  // Get variant details and calculate totals
  -  const variantIds = input.items.map((i) => i.variantId);
  -  const { data: variants } = await supabase
  -    .from("product_variants")
  -    .select("id, price_per_unit, unit_type, product_id, is_available")
  -    .in("id", variantIds);
  -
  -  if (!variants || variants.length !== variantIds.length) {
  -    return err("validation", "Some products are not available");
  -  }
  -
  -  const variantMap = new Map(variants.map((v) => [v.id, v]));
  -
  -  // Calculate total
  -  let totalAmount = 0;
  -  const orderItems: Omit<BuyerOrderItem, "id" | "order_id" | "created_at">[] = [];
  -
  -  for (const item of input.items) {
  -    const variant = variantMap.get(item.variantId);
  -    if (!variant || !variant.is_available) {
  -      return err("validation", `Product is not available`);
  -    }
  -    if (variant.unit_type === "per_piece" && !Number.isInteger(item.quantity)) {
  -      return err("validation", "Piece quantities must be whole numbers");
  -    }
  -    const subtotal = Math.round(Number(variant.price_per_unit) * item.quantity * 100) / 100;
  -    totalAmount += subtotal;
  -    orderItems.push({
  -      variant_id: variant.id,
  -      quantity: item.quantity,
  -      unit_price: variant.price_per_unit,
  -      subtotal,
  -    });
  -  }
  -
  -  // Create order
  -  const { data: order, error: orderError } = await supabase
  -    .from("buyer_orders")
  -    .insert({
  -      buyer_id: buyer.id,
  -      organization_id: buyer.organization_id,
  -      total_amount: totalAmount,
  -      delivery_address: input.deliveryAddress ?? buyer.address ?? null,
  -      notes: input.notes ?? null,
  -      status: "new",
  -    })
  -    .select()
  -    .single();
  -
  -  if (orderError || !order) {
  -    return err("internal", "Failed to create order");
  -  }
  -
  -  // Insert order items
  -  const itemsWithOrderId = orderItems.map((item) => ({
  -    ...item,
  -    order_id: order.id,
  -  }));
  -
  -  const { error: itemsError } = await supabase
  -    .from("buyer_order_items")
  -    .insert(itemsWithOrderId);
  -
  -  if (itemsError) {
  -    // Rollback: delete the order
  -    await supabase.from("buyer_orders").delete().eq("id", order.id);
  -    return err("internal", "Failed to create order items");
  -  }
  -
  -  revalidatePath("/orders");
  -  revalidatePath("/checkout");
  -
  -  return ok(order as BuyerOrder);
  -}
  ```
  `getOrganizationBySlug`, `getPublicCatalog`, `getProductForBuyer`, `getBuyerProfile`, and `updateBuyerProfile` are untouched — they aren't order-related.

- [ ] Edit `src/features/buyer/types.ts` — drop the old order status/enum/schemas and everything that structurally depends on them

  Read first (already read in full above — 124 lines). Delete the `OrderStatusEnum`/`OrderStatus`/`orderStatusLabels`/`orderStatusColors` block, `BuyerOrder`, `BuyerOrderItem`, `BuyerOrderListItem`, `OrderWithItems` (it extends `BuyerOrder`, which no longer exists — it must go too, even though the contract's cleanup list doesn't spell it out by name), `CartItemSchema`/`CartItem`, and `CheckoutInputSchema`/`CheckoutInput`. `Buyer`, `Category`, `Product`, `ProductVariant`, `CatalogCategory`, `CatalogWithProducts` all stay — none of them are order types.

  ```diff
  -import { z } from "zod";
  -
  -export const OrderStatusEnum = z.enum([
  -  "new",
  -  "preparing",
  -  "ready",
  -  "completed",
  -  "cancelled",
  -]);
  -export type OrderStatus = z.infer<typeof OrderStatusEnum>;
  -
  -export const orderStatusLabels: Record<OrderStatus, string> = {
  -  new: "New",
  -  preparing: "Preparing",
  -  ready: "Ready",
  -  completed: "Completed",
  -  cancelled: "Cancelled",
  -};
  -
  -export const orderStatusColors: Record<OrderStatus, string> = {
  -  new: "bg-blue-100 text-blue-800",
  -  preparing: "bg-yellow-100 text-yellow-800",
  -  ready: "bg-green-100 text-green-800",
  -  completed: "bg-gray-100 text-gray-800",
  -  cancelled: "bg-red-100 text-red-800",
  -};
  -
   // Database types
   export type Buyer = {
     id: string;
  @@
   };

  -export type BuyerOrder = {
  -  id: string;
  -  organization_id: string;
  -  buyer_id: string;
  -  status: OrderStatus;
  -  total_amount: number;
  -  delivery_address: string | null;
  -  notes: string | null;
  -  created_at: string;
  -  updated_at: string;
  -};
  -
  -export type BuyerOrderItem = {
  -  id: string;
  -  order_id: string;
  -  variant_id: string;
  -  quantity: number;
  -  unit_price: number;
  -  subtotal: number;
  -  created_at: string;
  -};
  -
   export type Category = {
     id: string;
  @@
   export type CatalogWithProducts = Category & {
     products: (Product & { variants?: ProductVariant[] })[];
   };
  -
  -export type BuyerOrderListItem = BuyerOrder & {
  -  items?: { id: string }[];
  -};
  -
  -export type OrderWithItems = BuyerOrder & {
  -  items: (BuyerOrderItem & { variant?: ProductVariant & { product?: Product } })[];
  -};
  -
  -export const CartItemSchema = z.object({
  -  variantId: z.string().uuid(),
  -  quantity: z.number().positive().max(10000),
  -});
  -
  -export type CartItem = z.infer<typeof CartItemSchema>;
  -
  -export const CheckoutInputSchema = z.object({
  -  items: z.array(CartItemSchema).min(1),
  -  deliveryAddress: z.string().min(1).max(500).optional(),
  -  notes: z.string().max(1000).optional(),
  -});
  -
  -export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;
  ```

  Resulting full file:
  ```ts
  /**
   * Buyer feature types and schemas.
   */

  // Database types
  export type Buyer = {
    id: string;
    organization_id: string;
    display_name: string;
    address: string | null;
    phone: string | null;
    created_at: string;
    updated_at: string;
  };

  export type Category = {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    display_order: number;
    is_active: boolean;
  };

  export type Product = {
    id: string;
    organization_id: string;
    category_id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    is_active: boolean;
  };

  export type ProductVariant = {
    id: string;
    organization_id: string;
    product_id: string;
    name: string;
    price_per_unit: number;
    unit_type: "per_kg" | "per_piece";
    is_available: boolean;
  };

  export type CatalogCategory = Category & {
    products: (Product & { variants: ProductVariant[] })[];
  };

  export type CatalogWithProducts = Category & {
    products: (Product & { variants?: ProductVariant[] })[];
  };
  ```

- [ ] Edit `src/features/seller/server/actions.ts` — drop the order functions and their now-unused imports

  Read first (already read in full above — 398 lines). `redirect` (from `next/navigation`) is already unused in the current file — bundle its removal into this same import hunk so `npm run lint` doesn't carry a pre-existing warning past this cleanup task.

  Hunk 1 — imports:
  ```diff
   "use server";

   import { revalidatePath } from "next/cache";
  -import { redirect } from "next/navigation";
   import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
   import type {
     CategoryInsert,
     CategoryUpdate,
     ProductInsert,
     ProductUpdate,
     ProductVariantInsert,
     ProductVariantUpdate,
     CustomerInsert,
     CustomerUpdate,
  -  OrderInsert,
  -  OrderUpdate,
  -  OrderItemInsert,
   } from "../types";
  ```

  Hunk 2 — delete `getOrders`, `getOrderWithItems`, `createOrder`, `updateOrderStatus` (the whole "Orders" section, but **not** `getCatalogForOrdering`, which the contract does not list for deletion and which is not superseded by anything in `src/features/orders/`):
  ```diff
     revalidateSellerPath(orgSlug, "customers");
   }

  -// ---------------------------------------------------------------------------
  -// Orders
  -// ---------------------------------------------------------------------------
  -export async function getOrders(orgId: string, status?: string) {
  -  const supabase = await createClient();
  -  let query = supabase
  -    .from("orders")
  -    .select(`
  -      *,
  -      customer:customers(*)
  -    `)
  -    .eq("organization_id", orgId)
  -    .order("created_at", { ascending: false });
  -
  -  if (status) {
  -    query = query.eq("status", status);
  -  }
  -
  -  const { data } = await query;
  -  return data ?? [];
  -}
  -
  -export async function getOrderWithItems(orderId: string) {
  -  const supabase = await createClient();
  -  const { data: order } = await supabase
  -    .from("orders")
  -    .select(`
  -      *,
  -      customer:customers(*),
  -      seller:profiles(*),
  -      items:order_items(
  -        *,
  -        variant:product_variants(*)
  -      )
  -    `)
  -    .eq("id", orderId)
  -    .single();
  -  return order;
  -}
  -
  -export async function createOrder(
  -  orgId: string,
  -  orderInput: Omit<OrderInsert, "organization_id" | "seller_id">,
  -  items: Omit<OrderItemInsert, "order_id">[],
  -  orgSlug?: string,
  -) {
  -  const supabase = await createClient();
  -  const { data: user } = await supabase.auth.getUser();
  -  if (!user.user) throw new Error("Not authenticated");
  -
  -  // Calculate total
  -  const total = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
  -
  -  const { data: order, error: orderError } = await supabase
  -    .from("orders")
  -    .insert({
  -      ...orderInput,
  -      organization_id: orgId,
  -      seller_id: user.user.id,
  -      total_amount: total,
  -    })
  -    .select()
  -    .single();
  -
  -  if (orderError) throw new Error(orderError.message);
  -
  -  // Insert order items
  -  const itemsWithOrderId = items.map((item) => ({ ...item, order_id: order.id }));
  -  const { error: itemsError } = await supabase.from("order_items").insert(itemsWithOrderId);
  -
  -  if (itemsError) throw new Error(itemsError.message);
  -
  -  revalidateSellerPath(orgSlug, "orders");
  -  return order;
  -}
  -
  -export async function updateOrderStatus(orderId: string, status: string, orgSlug?: string) {
  -  const supabase = await createClient();
  -  const { data, error } = await supabase
  -    .from("orders")
  -    .update({ status })
  -    .eq("id", orderId)
  -    .select()
  -    .single();
  -
  -  if (error) throw new Error(error.message);
  -  revalidateSellerPath(orgSlug, "orders");
  -  revalidateSellerPath(orgSlug, `orders/${orderId}`);
  -  return data;
  -}
  -
   export async function getCatalogForOrdering(orgId: string) {
     const supabase = await createClient();
     const { data } = await supabase
  ```
  `getOrganizationId`, `requireSellerRole`, `revalidateSellerPath`, and every Category/Product/Variant/Customer CRUD function are untouched.

- [ ] Edit `src/features/seller/types.ts` — drop every type derived from the now-dropped `orders`/`order_items` tables and `order_status` enum

  Read first (already read in full above — 59 lines). Migration 1 (Task 1) drops `public.order_status` and the old `orders`/`order_items` tables, so `Database["public"]["Tables"]["orders"]`, `["order_items"]`, and `Database["public"]["Enums"]["order_status"]` no longer exist once `npm run db:types` regenerates `src/types/database.generated.ts` — every type below would fail to compile even without this cleanup task. `Category*`, `Product*`, `ProductVariant*`, `Customer*`, `CatalogWithProducts`, `UnitType`, `UNIT_TYPES`, `UNIT_TYPE_LABELS` all stay.

  ```diff
   export type Customer = Database["public"]["Tables"]["customers"]["Row"];
   export type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
   export type CustomerUpdate = Database["public"]["Tables"]["customers"]["Update"];

  -export type Order = Database["public"]["Tables"]["orders"]["Row"];
  -export type OrderInsert = Database["public"]["Tables"]["orders"]["Insert"];
  -export type OrderUpdate = Database["public"]["Tables"]["orders"]["Update"];
  -
  -export type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];
  -export type OrderItemInsert = Database["public"]["Tables"]["order_items"]["Insert"];
  -
  -export type OrderStatus = Database["public"]["Enums"]["order_status"];
  -
  -export const ORDER_STATUSES: OrderStatus[] = ["new", "preparing", "ready", "completed", "cancelled"];
  -
  -export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  -  new: "New",
  -  preparing: "Preparing",
  -  ready: "Ready",
  -  completed: "Completed",
  -  cancelled: "Cancelled",
  -};
  -
   export type CatalogWithProducts = Category & {
     products: (Product & { variants: ProductVariant[] })[];
   };

  -export type OrderWithCustomer = Order & {
  -  customer: Customer;
  -};
  -
  -export type OrderWithDetails = Order & {
  -  customer: Customer;
  -  items: (OrderItem & { variant: ProductVariant & { product: Product } })[];
  -};
  -
   export type UnitType = "per_kg" | "per_piece";
  ```

  Resulting full file:
  ```ts
  import type { Database } from "@/types/database.generated";

  export type Category = Database["public"]["Tables"]["categories"]["Row"];
  export type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
  export type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];

  export type Product = Database["public"]["Tables"]["products"]["Row"];
  export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
  export type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

  export type ProductVariant = Database["public"]["Tables"]["product_variants"]["Row"];
  export type ProductVariantInsert = Database["public"]["Tables"]["product_variants"]["Insert"];
  export type ProductVariantUpdate = Database["public"]["Tables"]["product_variants"]["Update"];

  export type Customer = Database["public"]["Tables"]["customers"]["Row"];
  export type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
  export type CustomerUpdate = Database["public"]["Tables"]["customers"]["Update"];

  export type CatalogWithProducts = Category & {
    products: (Product & { variants: ProductVariant[] })[];
  };

  export type UnitType = "per_kg" | "per_piece";

  export const UNIT_TYPES: readonly UnitType[] = ["per_kg", "per_piece"] as const;

  export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
    per_kg: "Per kg",
    per_piece: "Per piece",
  };
  ```

- [ ] Grep for lingering imports of the deleted buyer symbols (unique names — no collision with the new `orders` module)
  ```bash
  grep -rn "createBuyerOrder\|getBuyerOrders\|getBuyerOrderWithItems" src
  ```
  Expected: no output (exit code 1).
  ```bash
  grep -rn "BuyerOrder\b\|BuyerOrderItem\b\|BuyerOrderListItem\b\|OrderStatusEnum\|orderStatusLabels\|orderStatusColors\|CartItemSchema\|CheckoutInputSchema" src
  ```
  Expected: no output (exit code 1).

- [ ] Grep for lingering imports of the deleted buyer `OrderWithItems` (this name is reused by `src/features/orders/types.ts`, so scope to files still importing from the old `buyer/types` path)
  ```bash
  grep -rln 'from "@/features/buyer/types"' src | xargs -r grep -n "OrderWithItems"
  ```
  Expected: no output.

- [ ] Grep for lingering imports of the deleted seller order actions (`getOrderWithItems`, `createOrder`, `updateOrderStatus` are unique; `getOrders` is reused by the new `order-actions.ts`, so it's scoped separately)
  ```bash
  grep -rn "\bgetOrderWithItems\b\|\bcreateOrder\b\|\bupdateOrderStatus\b" src
  ```
  Expected: no output.
  ```bash
  grep -rln 'from "@/features/seller/server/actions"' src | xargs -r grep -n "\bgetOrders\b"
  ```
  Expected: no output (the seller Products/Customers screens still import other names from this file, e.g. `deleteCategory`, `searchCustomers` — that's fine and expected; none of those files should additionally name `getOrders`).

- [ ] Grep for lingering imports of the deleted seller order types (`OrderInsert`, `OrderItemInsert`, `OrderUpdate`, `OrderWithCustomer`, `OrderWithDetails` are unique; `Order`, `OrderItem`, `OrderStatus`, `ORDER_STATUSES`, `ORDER_STATUS_LABELS` are reused by `src/features/orders/types.ts`, so scope to the old `seller/types` import path)
  ```bash
  grep -rln 'from "@/features/seller/types"' src | xargs -r grep -n "\bOrder\b\|\bOrderItem\b\|\bOrderInsert\b\|\bOrderItemInsert\b\|\bOrderUpdate\b\|\bOrderStatus\b\|\bORDER_STATUSES\b\|\bORDER_STATUS_LABELS\b\|\bOrderWithCustomer\b\|\bOrderWithDetails\b"
  ```
  Expected: no output.

- [ ] Grep pgTAP fixtures for the dropped `buyer_orders`/`buyer_order_items` tables
  ```bash
  grep -rln "buyer_orders\|buyer_order_items" supabase/tests
  ```
  Expected: no output (`supabase/tests/rls/` only has `00_template.sql` through `06_audit_log.sql` plus `organizations.sql` as of this plan — none reference the old order tables; the new order-pipeline pgTAP files added by Tasks 1-2 are `07_order_pipeline.sql` and `08_order_rpcs.sql`, which reference the *new* schema and are not in scope here).

- [ ] Run the full gate, one command at a time

  ```bash
  npm run typecheck
  ```
  Expected:
  ```
  > ayamnorliza@0.1.0 typecheck
  > tsc --noEmit
  ```
  (no errors printed, exit code 0)

  ```bash
  npm run lint
  ```
  Expected:
  ```
  > ayamnorliza@0.1.0 lint
  > eslint src

  ✔ No ESLint warnings or errors
  ```

  ```bash
  npm test
  ```
  Expected (vitest run, includes every `src/features/**/tests/unit/**/*.test.ts` and `src/lib/**/*.test.ts` file added by Tasks 1-13, plus every pre-existing suite):
  ```
  > ayamnorliza@0.1.0 test
  > vitest run

   Test Files  N passed (N)
        Tests  M passed (M)
     Duration  ...
  ```

  ```bash
  npm run db:test
  ```
  Expected:
  ```
  > ayamnorliza@0.1.0 db:test
  > supabase test db

  ...
  # All tests successful.
  ```

  ```bash
  npm run test:e2e
  ```
  Expected: every spec file in `e2e/` passes, including `order-pipeline.spec.ts` and `buyer-order.spec.ts` from Task 14 — `N passed`, no failures.

- [ ] Commit
  ```bash
  git add src/features/buyer/server/actions.ts src/features/buyer/types.ts src/features/seller/server/actions.ts src/features/seller/types.ts
  git commit -m "$(cat <<'EOF'
  chore(orders): remove superseded order code

  Deletes the old buyer_orders-backed buyer actions/types and the old
  orders-backed seller actions/types now that src/features/orders/*
  fully replaces both order flows.
  EOF
  )"
  ```

---

CONTRACT CONCERN #1: `getTodayTasks` (contract §"Server actions — order-actions.ts") is specified as filtering `order.delivery_date <= today`. `get_delivery_options` (contract §"RPCs", function 1) only ever offers dates in the window `current_date + 1 .. current_date + 14` — i.e. the earliest a `delivery_date` can ever be is tomorrow, relative to whenever the order was placed. Combined, these two rules mean a confirmed order's task can never appear on `/tasks` on the same calendar day it was created — `delivery_date` is always strictly greater than `current_date` at confirm time, so `delivery_date <= today` is false until at least a day has passed. That makes the "warehouse staff prep for an upcoming run" workflow described in the design doc (`docs/superpowers/specs/2026-08-10-order-module-design.md`, "ready" status: "staff completed the task: stock allocated to the truck bay...") untestable same-day, and, more importantly, means real staff would never see a task to prep *tomorrow's* run *today* — only overdue ones. RESOLVED — Task 8's `getTodayTasks` in this plan already implements the corrected filter (`delivery_date <= tomorrow`, see the `horizon` constant), so staff see and prep the next day's run in advance. `e2e/order-pipeline.spec.ts` in this file depends on that corrected filter; if an executor regresses it to `<= today`, the `/tasks` step in "owner creates a manual order, confirms with a fallback, and takes it through to close" will fail with the order never appearing in the list.

CONTRACT CONCERN #2: this task's specs necessarily invent specific accessible names (button text, field labels, radio names) for the new order-pipeline screens Tasks 9-13 own, since the contract only fixes literal copy for `FALLBACK_LABELS`, `ORDER_STATUS_LABELS`, and a few phrases quoted in the design doc ("truck returned" button, "Done" button, "close button"). The full list of assumed names this plan section commits to: mode radios `"Piece"` / `"Kg"`; field labels `"Quantity"`, `"Min size (kg)"`, `"Max size (kg)"`, `"Delivery zone"` (combobox placeholder "Select zone"), `"Delivery address"`, and a product combobox with placeholder "Select product"; the new-customer inline fields keep the existing `"Name *"` / `"Phone *"` / `"Save Customer"` labels (only the size/mode/fallback + zone/slot layer is new); the confirm panel's per-line availability control is two buttons `"Yes"` / `"No"`; action buttons `"Add item"`, `"Create order"`, `"Confirm"`, `"Mark departed"`, `"Truck returned"` (quoted verbatim from the design doc), `"Close"` (per the design doc's "close button"), `"Done"` (per the design doc), and `"Cancel order"` / `"Cancel Order"`; delivery-option radios are assumed to render their date as an ISO `YYYY-MM-DD` substring so `pickFirstDeliveryOption` can read it back for the `/runs` date picker, and that date picker is assumed to be `getByLabel(/date/i)`-reachable (a native `<input type="date">` or equivalent). If Tasks 9-13 land with different literal copy, reconcile by updating either side to match — do not silently rename in only one place, since the mismatch will show up as an E2E failure with no compile-time signal.

CONTRACT CONCERN #3 (informational, not a defect): `src/features/orders/types.ts` (Task 6) deliberately reuses the identifiers `Order`, `OrderItem`, `OrderStatus`, `ORDER_STATUSES`, `ORDER_STATUS_LABELS`, and `OrderWithItems` — the same names the old `src/features/seller/types.ts` and `src/features/buyer/types.ts` exported. Task 15's verification greps above are scoped by import path (`grep -rln 'from "@/features/seller/types"' | xargs grep ...`) specifically so they don't false-positive against the new module's legitimate, identically-named exports. If this cleanup is re-verified later with a plain repo-wide `grep -rn "\bOrderStatus\b" src`, expect many matches from the new, correct code — that is not a sign the cleanup failed.
