# Data Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner-only "Data console" page that wipes all business data (never users) and re-seeds realistic demo data — 13 products with real photos, 10 Johor customers, zones/bays/trucks, ~15 orders across the whole pipeline, 2 delivery runs — plus two guaranteed logins.

**Architecture:** Two `security definer` SQL RPCs (`admin_clear_org_data`, `admin_seed_demo_data`) own all data mutation inside single transactions, with the owner check inside the function. A thin Next.js server-action layer calls them; a server action also ensures the two console accounts exist via the service-role admin client. The page is a server component gate + client component with two confirm-guarded cards.

**Tech Stack:** Next.js App Router server actions, Supabase (Postgres RPC, GoTrue admin API), pgTAP, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-data-console-design.md`

## Global Constraints

- Users are NEVER deleted: `auth.users`, `organization_members`, `profiles`, `buyers`, `invitations`, and audit tables survive a clear.
- Console accounts after seed: `badrol@gmail.com` role `owner`, `hafizzudinsamad@gmail.com` role `org_admin`, both password `Password123!` (accepted risk, committed to repo).
- RPC auth: caller must be an **active `owner` member** of the target org — checked inside each RPC via `public.has_org_role(p_organization_id, array['owner'])`; failure raises `errcode 'P0001', message 'forbidden'`.
- Seed UUIDs are deterministic with prefix `dd000000-0000-0000-0000-…` so re-seeding is idempotent.
- Product images served statically from `public/product/` via `products.image_url`.
- The repo working tree has unrelated uncommitted WIP. `git add` ONLY the files listed in each task — never `git add -A` or `git add .`.
- Quality gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:test` (needs local Supabase running; start with `supabase start` if `supabase status` fails).

---

### Task 1: Rename product images to URL-safe names

Current filenames contain spaces, a colon, and a trailing space (`Leher ayam .jpg`) — unusable in URLs.

**Files:**
- Rename: everything in `public/product/`

**Interfaces:**
- Produces: the exact image paths Task 2's seed SQL references (`/product/<kebab-name>`).

- [ ] **Step 1: Rename all 13 images**

```bash
cd /Users/alob/AyamNorliza-1/public/product
mv "Ayam Pedaging Seekor Standard.jpg" ayam-pedaging.jpg
mv "Ayam Kampung Seekor.jpg" ayam-kampung.jpg
mv "Ayam Penelur : Ayam Tua Seekor.jpg" ayam-tua.jpg
mv dada.png dada-ayam.png
mv "Peha ayam.jpg" peha-ayam.jpg
mv "Pengkal Peha.jpg" pangkal-peha.jpg
mv "Kepak ayam.jpg" kepak-ayam.jpg
mv "chicken wing.jpg" chicken-wing.jpg
mv "Kaki ayam.jpg" kaki-ayam.jpg
mv "Leher ayam .jpg" leher-ayam.jpg
mv "Hati ayam.jpg" hati-ayam.jpg
mv "Rangka ayam.jpg" rangka-ayam.jpg
mv "Cop ayam.jpg" cop-ayam.jpg
```

- [ ] **Step 2: Verify**

Run: `ls /Users/alob/AyamNorliza-1/public/product/`
Expected: exactly 13 files, all kebab-case, no spaces.

- [ ] **Step 3: Commit**

```bash
git add public/product
git commit -m "chore: url-safe names for demo product images"
```

---

### Task 2: `admin_clear_org_data` + `admin_seed_demo_data` RPCs (TDD via pgTAP)

**Files:**
- Create: `supabase/tests/rls/16_data_console.sql`
- Create: `supabase/migrations/20260822000001_data_console_rpcs.sql`

**Interfaces:**
- Consumes: `public.has_org_role(uuid, text[])` (exists, `security definer`, checks active membership).
- Produces: `public.admin_clear_org_data(p_organization_id uuid) returns jsonb` (row counts deleted, e.g. `{"orders": 15, "products": 13, …}`) and `public.admin_seed_demo_data(p_organization_id uuid) returns jsonb` (`{"products": 13, "customers": 10, "orders": 15, "runs": 2}`). Both raise `P0001 'forbidden'` for non-owners. Granted to `authenticated`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/16_data_console.sql`:

```sql
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
insert into public.product_variants (id, organization_id, product_id, name, price_per_unit, created_by)
values ('dc000000-0000-0000-0000-000000000012', 'dc000000-0000-0000-0000-00000000000a', 'dc000000-0000-0000-0000-000000000011', 'Per kg', 10, 'dc000000-0000-0000-0000-000000000001');
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
  $$ values (13::bigint, 11::bigint, 15::bigint, 2::bigint) $$,
  'seed row counts (10 demo customers + 1 relinked buyer customer)');

-- 12: seeding twice is idempotent.
select pg_temp.impersonate('dc000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.admin_seed_demo_data('dc000000-0000-0000-0000-00000000000a') $$,
  'seed is idempotent');

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:test`
Expected: FAIL — `function public.admin_clear_org_data(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260822000001_data_console_rpcs.sql`:

```sql
-- 20260822000001_data_console_rpcs.sql
-- Data console RPCs: admin_clear_org_data wipes an org's business data
-- (never users); admin_seed_demo_data clears then inserts a deterministic
-- realistic demo dataset. Both security definer, owner-only, granted to
-- authenticated. Errors: P0001 'forbidden'.

begin;

-- ---------------------------------------------------------------------------
-- admin_clear_org_data
-- ---------------------------------------------------------------------------
create or replace function public.admin_clear_org_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
begin
  if not public.has_org_role(p_organization_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  -- Children first, parents last. Users/members/profiles/buyers/audit stay.
  delete from public.order_weight_log where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('order_weight_log', v_n);

  delete from public.delivery_attempts where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('delivery_attempts', v_n);

  delete from public.run_stop_events where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('run_stop_events', v_n);

  delete from public.order_tasks where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('order_tasks', v_n);

  delete from public.order_items
   where order_id in (select id from public.orders where organization_id = p_organization_id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('order_items', v_n);

  delete from public.orders where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('orders', v_n);

  delete from public.buyer_order_items
   where order_id in (select id from public.buyer_orders where organization_id = p_organization_id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('buyer_order_items', v_n);

  delete from public.buyer_orders where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('buyer_orders', v_n);

  delete from public.delivery_runs where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('delivery_runs', v_n);

  delete from public.schedule_blocks where organization_id = p_organization_id;
  delete from public.delivery_slots where organization_id = p_organization_id;

  -- Buyers are users: keep the row, drop the link to the doomed customer.
  update public.buyers set customer_id = null
   where organization_id = p_organization_id and customer_id is not null;

  delete from public.customers where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('customers', v_n);

  delete from public.product_variants where organization_id = p_organization_id;
  delete from public.products where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('products', v_n);
  delete from public.categories where organization_id = p_organization_id;

  delete from public.truck_zones where organization_id = p_organization_id;
  delete from public.trucks where organization_id = p_organization_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('trucks', v_n);

  delete from public.zone_postcode_ranges where organization_id = p_organization_id;
  delete from public.delivery_zones where organization_id = p_organization_id;
  delete from public.bays where organization_id = p_organization_id;
  delete from public.facilities where organization_id = p_organization_id;

  return v_counts;
end;
$$;

revoke all on function public.admin_clear_org_data(uuid) from public;
grant execute on function public.admin_clear_org_data(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_seed_demo_data
-- ---------------------------------------------------------------------------
create or replace function public.admin_seed_demo_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  -- Owner check happens inside admin_clear_org_data; call it first so the
  -- seed always starts from a blank slate and stays idempotent.
  perform public.admin_clear_org_data(p_organization_id);

  -- Catalog ------------------------------------------------------------------
  insert into public.categories (id, organization_id, name, description, created_by)
  values ('dd000000-0000-0000-0000-00000000c001', p_organization_id, 'Ayam Segar',
          'Fresh chicken, whole birds and cuts', v_actor);

  insert into public.products (id, organization_id, category_id, name, image_url, created_by)
  select x.id, p_organization_id, 'dd000000-0000-0000-0000-00000000c001', x.name, x.image_url, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000101'::uuid, 'Ayam Pedaging Seekor (Standard)', '/product/ayam-pedaging.jpg'),
    ('dd000000-0000-0000-0000-000000000102'::uuid, 'Ayam Kampung Seekor',             '/product/ayam-kampung.jpg'),
    ('dd000000-0000-0000-0000-000000000103'::uuid, 'Ayam Tua / Penelur Seekor',       '/product/ayam-tua.jpg'),
    ('dd000000-0000-0000-0000-000000000104'::uuid, 'Dada Ayam',                       '/product/dada-ayam.png'),
    ('dd000000-0000-0000-0000-000000000105'::uuid, 'Peha Ayam',                       '/product/peha-ayam.jpg'),
    ('dd000000-0000-0000-0000-000000000106'::uuid, 'Pangkal Peha',                    '/product/pangkal-peha.jpg'),
    ('dd000000-0000-0000-0000-000000000107'::uuid, 'Kepak Ayam',                      '/product/kepak-ayam.jpg'),
    ('dd000000-0000-0000-0000-000000000108'::uuid, 'Chicken Wing (3-Joint)',          '/product/chicken-wing.jpg'),
    ('dd000000-0000-0000-0000-000000000109'::uuid, 'Kaki Ayam',                       '/product/kaki-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010a'::uuid, 'Leher Ayam',                      '/product/leher-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010b'::uuid, 'Hati Ayam',                       '/product/hati-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010c'::uuid, 'Rangka Ayam',                     '/product/rangka-ayam.jpg'),
    ('dd000000-0000-0000-0000-00000000010d'::uuid, 'Cop Ayam',                        '/product/cop-ayam.jpg')
  ) as x(id, name, image_url);

  insert into public.product_variants (id, organization_id, product_id, name, price_per_unit, created_by)
  select x.id, p_organization_id, x.product_id, x.name, x.price, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000201'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'Per kg',    11.50),
    ('dd000000-0000-0000-0000-000000000202'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'Per ekor',  16.00),
    ('dd000000-0000-0000-0000-000000000203'::uuid, 'dd000000-0000-0000-0000-000000000102'::uuid, 'Per ekor',  28.00),
    ('dd000000-0000-0000-0000-000000000204'::uuid, 'dd000000-0000-0000-0000-000000000103'::uuid, 'Per ekor',  14.00),
    ('dd000000-0000-0000-0000-000000000205'::uuid, 'dd000000-0000-0000-0000-000000000104'::uuid, 'Per kg',    15.00),
    ('dd000000-0000-0000-0000-000000000206'::uuid, 'dd000000-0000-0000-0000-000000000105'::uuid, 'Per kg',    13.00),
    ('dd000000-0000-0000-0000-000000000207'::uuid, 'dd000000-0000-0000-0000-000000000106'::uuid, 'Per kg',    13.50),
    ('dd000000-0000-0000-0000-000000000208'::uuid, 'dd000000-0000-0000-0000-000000000107'::uuid, 'Per kg',    16.00),
    ('dd000000-0000-0000-0000-000000000209'::uuid, 'dd000000-0000-0000-0000-000000000108'::uuid, 'Per kg',    15.00),
    ('dd000000-0000-0000-0000-00000000020a'::uuid, 'dd000000-0000-0000-0000-000000000109'::uuid, 'Per kg',     6.00),
    ('dd000000-0000-0000-0000-00000000020b'::uuid, 'dd000000-0000-0000-0000-00000000010a'::uuid, 'Per kg',     7.00),
    ('dd000000-0000-0000-0000-00000000020c'::uuid, 'dd000000-0000-0000-0000-00000000010b'::uuid, 'Per kg',     9.00),
    ('dd000000-0000-0000-0000-00000000020d'::uuid, 'dd000000-0000-0000-0000-00000000010c'::uuid, 'Per kg',     5.00),
    ('dd000000-0000-0000-0000-00000000020e'::uuid, 'dd000000-0000-0000-0000-00000000010d'::uuid, 'Per kg',    12.00)
  ) as x(id, product_id, name, price);

  -- Customers ----------------------------------------------------------------
  insert into public.customers (id, organization_id, name, phone, address, created_by)
  select x.id, p_organization_id, x.name, x.phone, x.address, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000301'::uuid, 'Restoran Nasi Ayam Hj Salleh', '012-7011234', '12 Jalan Dhoby, 80000 Johor Bahru'),
    ('dd000000-0000-0000-0000-000000000302'::uuid, 'Kedai Makan Mak Timah',        '013-7405566', '8 Jalan Molek 1/9, 81100 Johor Bahru'),
    ('dd000000-0000-0000-0000-000000000303'::uuid, 'Pasar Raya Aneka Skudai',      '07-5566788',  '2 Jalan Kebudayaan 4, 81300 Skudai'),
    ('dd000000-0000-0000-0000-000000000304'::uuid, 'Restoran Selera Kampung',      '011-10998877','5 Persiaran Puteri Selatan, 79100 Iskandar Puteri'),
    ('dd000000-0000-0000-0000-000000000305'::uuid, 'Ayamas Frozen Mart',           '012-7223344', '31 Jalan Sutera Tanjung 8/2, 80350 Johor Bahru'),
    ('dd000000-0000-0000-0000-000000000306'::uuid, 'Restoran Wan Sup Ayam',        '013-7778899', '14 Jalan Rahmat, 83000 Batu Pahat'),
    ('dd000000-0000-0000-0000-000000000307'::uuid, 'Kak Ros Catering',             '019-7551122', '3 Jalan Bakri, 84000 Muar'),
    ('dd000000-0000-0000-0000-000000000308'::uuid, 'Gerai Ayam Goreng Abu',        '017-7663355', '21 Jalan Besar, 83700 Yong Peng'),
    ('dd000000-0000-0000-0000-000000000309'::uuid, 'Restoran Bismillah Segamat',   '012-6889900', '9 Jalan Genuang, 85000 Segamat'),
    ('dd000000-0000-0000-0000-00000000030a'::uuid, 'Kluang Fresh Mart',            '018-7112233', '17 Jalan Duku, 86000 Kluang')
  ) as x(id, name, phone, address);

  -- Relink existing buyer accounts to fresh customer rows so buyer logins
  -- keep an order-ready CRM identity after the wipe.
  insert into public.customers (id, organization_id, name, phone, created_by)
  select b.id, p_organization_id, b.display_name, coalesce(b.phone, '-----'), v_actor
  from public.buyers b
  where b.organization_id = p_organization_id
  on conflict (id) do nothing;

  update public.buyers set customer_id = id
  where organization_id = p_organization_id;

  -- Logistics setup (matches the delivery setup console) ---------------------
  insert into public.facilities (id, organization_id, name, address_line, postcode, state, created_by)
  values ('dd000000-0000-0000-0000-000000000501', p_organization_id, 'Depoh Utama',
          'Lot 8, Jalan Perindustrian Senai 3', '81400', 'Johor', v_actor);

  insert into public.bays (id, organization_id, facility_id, name, position, created_by)
  values
    ('dd000000-0000-0000-0000-000000000511', p_organization_id, 'dd000000-0000-0000-0000-000000000501', 'Bay A', 0, v_actor),
    ('dd000000-0000-0000-0000-000000000512', p_organization_id, 'dd000000-0000-0000-0000-000000000501', 'Bay B', 1, v_actor);

  insert into public.delivery_zones (id, organization_id, name, display_order, created_by)
  values
    ('dd000000-0000-0000-0000-000000000401', p_organization_id, 'Zone 1', 0, v_actor),
    ('dd000000-0000-0000-0000-000000000402', p_organization_id, 'Zone 2', 1, v_actor),
    ('dd000000-0000-0000-0000-000000000403', p_organization_id, 'Zone 3', 2, v_actor);

  insert into public.zone_postcode_ranges (id, organization_id, zone_id, postcode_start, postcode_end, created_by)
  values
    ('dd000000-0000-0000-0000-000000000411', p_organization_id, 'dd000000-0000-0000-0000-000000000401', '79000', '82999', v_actor),
    ('dd000000-0000-0000-0000-000000000412', p_organization_id, 'dd000000-0000-0000-0000-000000000402', '83000', '84999', v_actor),
    ('dd000000-0000-0000-0000-000000000413', p_organization_id, 'dd000000-0000-0000-0000-000000000403', '85000', '86999', v_actor);

  insert into public.trucks (id, organization_id, name, code, bay_id, capacity_kg, created_by)
  values
    ('dd000000-0000-0000-0000-000000000601', p_organization_id, 'Truck South Zone',        'TRK-A', 'dd000000-0000-0000-0000-000000000511', 800, v_actor),
    ('dd000000-0000-0000-0000-000000000602', p_organization_id, 'Truck West Coast Zone',   'TRK-B', 'dd000000-0000-0000-0000-000000000512', 800, v_actor),
    ('dd000000-0000-0000-0000-000000000603', p_organization_id, 'Truck North & East Zone', 'TRK-C', null, 600, v_actor);

  insert into public.truck_zones (truck_id, zone_id, organization_id)
  values
    ('dd000000-0000-0000-0000-000000000601', 'dd000000-0000-0000-0000-000000000401', p_organization_id),
    ('dd000000-0000-0000-0000-000000000602', 'dd000000-0000-0000-0000-000000000402', p_organization_id),
    ('dd000000-0000-0000-0000-000000000603', 'dd000000-0000-0000-0000-000000000403', p_organization_id);

  -- One 09:00-13:00 slot per truck per weekday, so any delivery date works.
  insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, created_by)
  select p_organization_id, t.id, d.weekday::smallint, '09:00'::time, '13:00'::time, v_actor
  from (values
    ('dd000000-0000-0000-0000-000000000601'::uuid),
    ('dd000000-0000-0000-0000-000000000602'::uuid),
    ('dd000000-0000-0000-0000-000000000603'::uuid)
  ) as t(id)
  cross join generate_series(0, 6) as d(weekday);

  -- Runs ---------------------------------------------------------------------
  -- Run A: today, TRK-A, being loaded. Run B: yesterday, TRK-B, completed.
  insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
  values
    ('dd000000-0000-0000-0000-000000000701', p_organization_id, 'dd000000-0000-0000-0000-000000000601', v_today, 'planned'),
    ('dd000000-0000-0000-0000-000000000702', p_organization_id, 'dd000000-0000-0000-0000-000000000602', v_today - 1, 'completed');

  -- Orders -------------------------------------------------------------------
  -- 4 pending, 2 confirmed w/ open task, 1 confirmed weighed, 4 ready on run
  -- A (2 loaded), 3 delivered on run B, 1 cancelled = 15.
  insert into public.orders (
    id, organization_id, customer_id, created_by, source, status, zone_id,
    delivery_address, postcode, delivery_date, slot_id, truck_id, run_id,
    run_sequence, assignment_source, total_amount, loaded_at, loaded_by, closed_at
  )
  select
    o.id, p_organization_id, o.customer_id, v_actor, 'manual', o.status::public.order_status,
    o.zone_id,
    (select address from public.customers c where c.id = o.customer_id),
    o.postcode, v_today + o.date_offset,
    (select s.id from public.delivery_slots s
      where s.organization_id = p_organization_id and s.truck_id = o.truck_id
        and s.weekday = extract(dow from v_today + o.date_offset)::smallint limit 1),
    o.truck_id, o.run_id, o.run_sequence,
    (case when o.run_id is null then 'none' else 'auto' end)::public.assignment_source,
    o.total_amount,
    case when o.loaded then now() - interval '2 hours' else null end,
    case when o.loaded then v_actor else null end,
    case when o.status = 'delivered' then now() - interval '20 hours' else null end
  from (values
    -- pending
    ('dd000000-0000-0000-0000-000000000801'::uuid, 'dd000000-0000-0000-0000-000000000301'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000401'::uuid, '80000', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null::uuid, null::int, 0::numeric, false),
    ('dd000000-0000-0000-0000-000000000802'::uuid, 'dd000000-0000-0000-0000-000000000302'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000401'::uuid, '81100', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null, null, 0, false),
    ('dd000000-0000-0000-0000-000000000803'::uuid, 'dd000000-0000-0000-0000-000000000306'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000402'::uuid, '83000', 2, 'dd000000-0000-0000-0000-000000000602'::uuid, null, null, 0, false),
    ('dd000000-0000-0000-0000-000000000804'::uuid, 'dd000000-0000-0000-0000-000000000309'::uuid, 'pending',   'dd000000-0000-0000-0000-000000000403'::uuid, '85000', 3, 'dd000000-0000-0000-0000-000000000603'::uuid, null, null, 0, false),
    -- confirmed, task open
    ('dd000000-0000-0000-0000-000000000805'::uuid, 'dd000000-0000-0000-0000-000000000303'::uuid, 'confirmed', 'dd000000-0000-0000-0000-000000000401'::uuid, '81300', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null, null, 0, false),
    ('dd000000-0000-0000-0000-000000000806'::uuid, 'dd000000-0000-0000-0000-000000000307'::uuid, 'confirmed', 'dd000000-0000-0000-0000-000000000402'::uuid, '84000', 2, 'dd000000-0000-0000-0000-000000000602'::uuid, null, null, 0, false),
    -- confirmed, warehouse weighed (task done)
    ('dd000000-0000-0000-0000-000000000807'::uuid, 'dd000000-0000-0000-0000-000000000304'::uuid, 'confirmed', 'dd000000-0000-0000-0000-000000000401'::uuid, '79100', 1, 'dd000000-0000-0000-0000-000000000601'::uuid, null, null, 0, false),
    -- ready on run A (today, TRK-A); first two already loaded
    ('dd000000-0000-0000-0000-000000000808'::uuid, 'dd000000-0000-0000-0000-000000000301'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '80000', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 1, 0, true),
    ('dd000000-0000-0000-0000-000000000809'::uuid, 'dd000000-0000-0000-0000-000000000302'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '81100', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 2, 0, true),
    ('dd000000-0000-0000-0000-00000000080a'::uuid, 'dd000000-0000-0000-0000-000000000303'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '81300', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 3, 0, false),
    ('dd000000-0000-0000-0000-00000000080b'::uuid, 'dd000000-0000-0000-0000-000000000305'::uuid, 'ready',     'dd000000-0000-0000-0000-000000000401'::uuid, '80350', 0, 'dd000000-0000-0000-0000-000000000601'::uuid, 'dd000000-0000-0000-0000-000000000701'::uuid, 4, 0, false),
    -- delivered yesterday on run B (TRK-B)
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'dd000000-0000-0000-0000-000000000306'::uuid, 'delivered', 'dd000000-0000-0000-0000-000000000402'::uuid, '83000', -1, 'dd000000-0000-0000-0000-000000000602'::uuid, 'dd000000-0000-0000-0000-000000000702'::uuid, 1, 187.20, false),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'dd000000-0000-0000-0000-000000000307'::uuid, 'delivered', 'dd000000-0000-0000-0000-000000000402'::uuid, '84000', -1, 'dd000000-0000-0000-0000-000000000602'::uuid, 'dd000000-0000-0000-0000-000000000702'::uuid, 2, 97.50, false),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'dd000000-0000-0000-0000-000000000308'::uuid, 'delivered', 'dd000000-0000-0000-0000-000000000402'::uuid, '83700', -1, 'dd000000-0000-0000-0000-000000000602'::uuid, 'dd000000-0000-0000-0000-000000000702'::uuid, 3, 138.00, false),
    -- cancelled
    ('dd000000-0000-0000-0000-00000000080f'::uuid, 'dd000000-0000-0000-0000-00000000030a'::uuid, 'cancelled', 'dd000000-0000-0000-0000-000000000403'::uuid, '86000', 2, 'dd000000-0000-0000-0000-000000000603'::uuid, null, null, 0, false)
  ) as o(id, customer_id, status, zone_id, postcode, date_offset, truck_id, run_id, run_sequence, total_amount, loaded);

  -- Order items --------------------------------------------------------------
  -- Weighed/delivered lines carry warehouse and/or final weights + price.
  insert into public.order_items (
    id, order_id, product_id, mode, quantity, size_min_kg, size_max_kg,
    fallback, warehouse_weight_kg, final_weight_kg, price_per_kg
  )
  select x.id, x.order_id, x.product_id, x.mode::public.order_item_mode, x.qty,
         x.smin, x.smax, 'mix'::public.order_fallback, x.wkg, x.fkg, x.price
  from (values
    -- pending orders: raw requests only
    ('dd000000-0000-0000-0000-000000000901'::uuid, 'dd000000-0000-0000-0000-000000000801'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 10::numeric, 1.3::numeric, 1.6::numeric, null::numeric, null::numeric, null::numeric),
    ('dd000000-0000-0000-0000-000000000902'::uuid, 'dd000000-0000-0000-0000-000000000801'::uuid, 'dd000000-0000-0000-0000-000000000104'::uuid, 'kg',     5, 0.3, 0.5, null, null, null),
    ('dd000000-0000-0000-0000-000000000903'::uuid, 'dd000000-0000-0000-0000-000000000802'::uuid, 'dd000000-0000-0000-0000-000000000102'::uuid, 'piece',  4, 1.1, 1.4, null, null, null),
    ('dd000000-0000-0000-0000-000000000904'::uuid, 'dd000000-0000-0000-0000-000000000803'::uuid, 'dd000000-0000-0000-0000-000000000105'::uuid, 'kg',     8, 0.2, 0.4, null, null, null),
    ('dd000000-0000-0000-0000-000000000905'::uuid, 'dd000000-0000-0000-0000-000000000804'::uuid, 'dd000000-0000-0000-0000-000000000107'::uuid, 'kg',     6, 0.1, 0.3, null, null, null),
    -- confirmed, task open
    ('dd000000-0000-0000-0000-000000000906'::uuid, 'dd000000-0000-0000-0000-000000000805'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 20, 1.4, 1.8, null, null, null),
    ('dd000000-0000-0000-0000-000000000907'::uuid, 'dd000000-0000-0000-0000-000000000806'::uuid, 'dd000000-0000-0000-0000-00000000010b'::uuid, 'kg',     3, 0.1, 0.2, null, null, null),
    -- confirmed, warehouse weighed
    ('dd000000-0000-0000-0000-000000000908'::uuid, 'dd000000-0000-0000-0000-000000000807'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 15, 1.3, 1.7, 23.4, null, null),
    -- ready on run A: warehouse weighed
    ('dd000000-0000-0000-0000-000000000909'::uuid, 'dd000000-0000-0000-0000-000000000808'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 12, 1.3, 1.6, 17.8, null, null),
    ('dd000000-0000-0000-0000-00000000090a'::uuid, 'dd000000-0000-0000-0000-000000000808'::uuid, 'dd000000-0000-0000-0000-000000000109'::uuid, 'kg',     4, 0.1, 0.2,  4.1, null, null),
    ('dd000000-0000-0000-0000-00000000090b'::uuid, 'dd000000-0000-0000-0000-000000000809'::uuid, 'dd000000-0000-0000-0000-000000000106'::uuid, 'kg',    10, 0.2, 0.4, 10.3, null, null),
    ('dd000000-0000-0000-0000-00000000090c'::uuid, 'dd000000-0000-0000-0000-00000000080a'::uuid, 'dd000000-0000-0000-0000-000000000104'::uuid, 'kg',     6, 0.3, 0.5,  6.2, null, null),
    ('dd000000-0000-0000-0000-00000000090d'::uuid, 'dd000000-0000-0000-0000-00000000080b'::uuid, 'dd000000-0000-0000-0000-00000000010c'::uuid, 'kg',    12, 0.5, 0.9, 12.6, null, null),
    -- delivered: final weight + price (line totals sum to the order totals)
    ('dd000000-0000-0000-0000-00000000090e'::uuid, 'dd000000-0000-0000-0000-00000000080c'::uuid, 'dd000000-0000-0000-0000-000000000101'::uuid, 'piece', 10, 1.4, 1.8, 16.5, 16.0, 11.70),
    ('dd000000-0000-0000-0000-00000000090f'::uuid, 'dd000000-0000-0000-0000-00000000080d'::uuid, 'dd000000-0000-0000-0000-000000000105'::uuid, 'kg',     7, 0.2, 0.4,  7.6,  7.5, 13.00),
    ('dd000000-0000-0000-0000-000000000910'::uuid, 'dd000000-0000-0000-0000-00000000080e'::uuid, 'dd000000-0000-0000-0000-000000000107'::uuid, 'kg',     9, 0.1, 0.3,  8.8,  8.625, 16.00),
    -- cancelled
    ('dd000000-0000-0000-0000-000000000911'::uuid, 'dd000000-0000-0000-0000-00000000080f'::uuid, 'dd000000-0000-0000-0000-000000000103'::uuid, 'piece',  5, 1.0, 1.4, null, null, null)
  ) as x(id, order_id, product_id, mode, qty, smin, smax, wkg, fkg, price);

  -- Tasks: open for 805/806, done for the weighed/ready/delivered orders.
  insert into public.order_tasks (organization_id, order_id, type, status, done_by, done_at)
  select p_organization_id, x.order_id, 'allocate_weigh', x.status::public.order_task_status,
         case when x.status = 'done' then v_actor end,
         case when x.status = 'done' then now() - interval '5 hours' end
  from (values
    ('dd000000-0000-0000-0000-000000000805'::uuid, 'pending'),
    ('dd000000-0000-0000-0000-000000000806'::uuid, 'pending'),
    ('dd000000-0000-0000-0000-000000000807'::uuid, 'done'),
    ('dd000000-0000-0000-0000-000000000808'::uuid, 'done'),
    ('dd000000-0000-0000-0000-000000000809'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080a'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080b'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'done'),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'done')
  ) as x(order_id, status);

  -- Warehouse weight log entries for every weighed line.
  insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, recorded_by)
  select p_organization_id, i.id, 'warehouse', i.warehouse_weight_kg, v_actor
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.organization_id = p_organization_id and i.warehouse_weight_kg is not null;

  -- Run B history: arrive/leave marks + delivered attempts for each stop.
  insert into public.run_stop_events (organization_id, run_id, order_id, kind, at, recorded_by)
  select p_organization_id, 'dd000000-0000-0000-0000-000000000702', x.order_id,
         x.kind::public.stop_event_kind, now() - interval '24 hours' + x.offset_min * interval '1 minute', v_actor
  from (values
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'arrive',  0),
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'leave',  12),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'arrive', 45),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'leave',  58),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'arrive', 95),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'leave', 110)
  ) as x(order_id, kind, offset_min);

  insert into public.delivery_attempts (organization_id, run_id, order_id, outcome, received_by, cash_collected, attempted_at, recorded_by)
  select p_organization_id, 'dd000000-0000-0000-0000-000000000702', x.order_id, 'delivered',
         x.received_by, x.cash, now() - interval '24 hours' + x.offset_min * interval '1 minute', v_actor
  from (values
    ('dd000000-0000-0000-0000-00000000080c'::uuid, 'Wan',      187.20::numeric, 10),
    ('dd000000-0000-0000-0000-00000000080d'::uuid, 'Kak Ros',   97.50, 56),
    ('dd000000-0000-0000-0000-00000000080e'::uuid, 'Abu',      138.00, 108)
  ) as x(order_id, received_by, cash, offset_min);

  -- Buyer portal: two orders for any existing buyer (skipped when none).
  insert into public.buyer_orders (id, organization_id, buyer_id, status, total_amount, delivery_address)
  select x.id, p_organization_id, b.id, 'new', x.total, '12 Jalan Dhoby, 80000 Johor Bahru'
  from (values
    ('dd000000-0000-0000-0000-000000000a01'::uuid, 57.50::numeric),
    ('dd000000-0000-0000-0000-000000000a02'::uuid, 28.00::numeric)
  ) as x(id, total)
  cross join lateral (
    select id from public.buyers where organization_id = p_organization_id limit 1
  ) as b;

  insert into public.buyer_order_items (order_id, variant_id, quantity, unit_price, subtotal)
  select x.order_id, x.variant_id, x.qty, x.price, x.qty * x.price
  from (values
    ('dd000000-0000-0000-0000-000000000a01'::uuid, 'dd000000-0000-0000-0000-000000000201'::uuid, 5, 11.50::numeric),
    ('dd000000-0000-0000-0000-000000000a02'::uuid, 'dd000000-0000-0000-0000-000000000203'::uuid, 1, 28.00::numeric)
  ) as x(order_id, variant_id, qty, price)
  where exists (select 1 from public.buyer_orders where id = x.order_id);

  return jsonb_build_object('products', 13, 'customers', 10, 'orders', 15, 'runs', 2);
end;
$$;

revoke all on function public.admin_seed_demo_data(uuid) from public;
grant execute on function public.admin_seed_demo_data(uuid) to authenticated;

commit;
```

- [ ] **Step 2b: Apply the migration**

Run: `supabase db reset` (re-applies all migrations + `seed.sql`).
Expected: finishes without error.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run db:test`
Expected: `16_data_console.sql` — 12/12 PASS, all other suites still green. If `results_eq` counts differ, check whether the org already had a buyer (the fixture creates one, hence 11 customers).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260822000001_data_console_rpcs.sql supabase/tests/rls/16_data_console.sql
git commit -m "feat(console): clear and demo-seed RPCs, owner-only"
```

---

### Task 3: Admin client extension + server actions

**Files:**
- Modify: `src/lib/supabase/admin.ts` (add `ensureUserWithPassword`, `upsertProfileAndMembership`)
- Create: `src/features/data-console/server/actions.ts`
- Test: `src/features/data-console/tests/unit/console-accounts.test.ts`

**Interfaces:**
- Consumes: `requireOrgRole(organizationSlug, roles)` from `@/features/orders/server/guards` (throws `OrderPermissionError`); RPCs from Task 2; `admin` from `@/lib/supabase/admin`.
- Produces:
  - `clearAllData(organizationSlug: string): Promise<ActionResult<{ counts: Record<string, number> }>>`
  - `seedDemoData(organizationSlug: string): Promise<ActionResult<{ summary: Record<string, number> }>>`
  - `CONSOLE_ACCOUNTS: readonly { email: string; displayName: string; role: "owner" | "org_admin" }[]` exported from `src/features/data-console/lib/accounts.ts` (client-safe, no password).
  - `ActionResult<T>` = `{ ok: true; data: T } | { ok: false; code: string; message: string }` (same shape as orders).

- [ ] **Step 1: Write the failing unit test**

The accounts list is the only pure logic worth a unit test (the actions are I/O glue covered by pgTAP + e2e). Create `src/features/data-console/tests/unit/console-accounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONSOLE_ACCOUNTS } from "../../lib/accounts";

describe("CONSOLE_ACCOUNTS", () => {
  it("declares exactly the two console logins from the spec", () => {
    expect(CONSOLE_ACCOUNTS).toEqual([
      { email: "badrol@gmail.com", displayName: "Badrol", role: "owner" },
      { email: "hafizzudinsamad@gmail.com", displayName: "Hafizzudin Samad", role: "org_admin" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/data-console/tests/unit/console-accounts.test.ts`
Expected: FAIL — cannot resolve `../../lib/accounts`.

- [ ] **Step 3: Create `src/features/data-console/lib/accounts.ts`**

```ts
/**
 * The two always-available console logins the Seed action guarantees.
 * Client-safe: the shared password lives server-side in
 * server/actions.ts (an accepted, documented risk for this pilot —
 * see docs/superpowers/specs/2026-08-22-data-console-design.md).
 */
export const CONSOLE_ACCOUNTS = [
  { email: "badrol@gmail.com", displayName: "Badrol", role: "owner" },
  { email: "hafizzudinsamad@gmail.com", displayName: "Hafizzudin Samad", role: "org_admin" },
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/data-console/tests/unit/console-accounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `src/lib/supabase/admin.ts`**

Add two methods to the exported `admin` object (keep the existing narrow-API comment style):

```ts
  /**
   * Create a password login if the email is unknown, otherwise reset the
   * existing user's password. Data console only. Returns the user id.
   */
  async ensureUserWithPassword(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<string> {
    const c = client();
    const { data, error } = await c.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.displayName },
    });
    if (!error && data.user) return data.user.id;

    // Already registered -> find the account and align its password.
    const { data: list, error: listError } = await c.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    const existing = list.users.find(
      (u) => u.email?.toLowerCase() === input.email.toLowerCase(),
    );
    if (!existing) throw error ?? new Error("ensureUserWithPassword: user not found");
    const { error: updateError } = await c.auth.admin.updateUserById(existing.id, {
      password: input.password,
    });
    if (updateError) throw updateError;
    return existing.id;
  },

  /**
   * Idempotent profile + active org membership for a console account.
   * Data console only.
   */
  async upsertProfileAndMembership(input: {
    userId: string;
    displayName: string;
    organizationId: string;
    role: string;
    invitedBy: string;
  }): Promise<void> {
    const c = client();
    const { error: profileError } = await c.from("profiles").upsert(
      {
        user_id: input.userId,
        display_name: input.displayName,
        locale: "en",
        time_zone: "Asia/Kuala_Lumpur",
        status: "active",
      },
      { onConflict: "user_id" },
    );
    if (profileError) throw profileError;
    const { error: memberError } = await c.from("organization_members").upsert(
      {
        organization_id: input.organizationId,
        user_id: input.userId,
        role: input.role,
        status: "active",
        invited_by: input.invitedBy,
      },
      { onConflict: "organization_id,user_id" },
    );
    if (memberError) throw memberError;
  },
```

- [ ] **Step 6: Create `src/features/data-console/server/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { CONSOLE_ACCOUNTS } from "../lib/accounts";

// Committed on purpose: pilot-only demo logins, accepted risk documented in
// docs/superpowers/specs/2026-08-22-data-console-design.md.
const CONSOLE_PASSWORD = "Password123!";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "forbidden" | "internal"; message: string };

async function guardOwner(organizationSlug: string) {
  try {
    return await requireOrgRole(organizationSlug, ["owner"]);
  } catch (e) {
    if (e instanceof OrderPermissionError) return null;
    throw e;
  }
}

export async function clearAllData(
  organizationSlug: string,
): Promise<ActionResult<{ counts: Record<string, number> }>> {
  const ctx = await guardOwner(organizationSlug);
  if (!ctx) return { ok: false, code: "forbidden", message: "Owner only." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_clear_org_data", {
    p_organization_id: ctx.orgId,
  });
  if (error) {
    const forbidden = error.message === "forbidden";
    return {
      ok: false,
      code: forbidden ? "forbidden" : "internal",
      message: forbidden ? "Owner only." : "Clearing failed — nothing was deleted.",
    };
  }
  revalidatePath(`/${organizationSlug}`, "layout");
  return { ok: true, data: { counts: (data ?? {}) as Record<string, number> } };
}

export async function seedDemoData(
  organizationSlug: string,
): Promise<ActionResult<{ summary: Record<string, number> }>> {
  const ctx = await guardOwner(organizationSlug);
  if (!ctx) return { ok: false, code: "forbidden", message: "Owner only." };

  try {
    for (const account of CONSOLE_ACCOUNTS) {
      const userId = await admin.ensureUserWithPassword({
        email: account.email,
        password: CONSOLE_PASSWORD,
        displayName: account.displayName,
      });
      await admin.upsertProfileAndMembership({
        userId,
        displayName: account.displayName,
        organizationId: ctx.orgId,
        role: account.role,
        invitedBy: ctx.userId,
      });
    }
  } catch {
    return {
      ok: false,
      code: "internal",
      message: "Could not ensure the console accounts — seeding was not started.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_seed_demo_data", {
    p_organization_id: ctx.orgId,
  });
  if (error) {
    const forbidden = error.message === "forbidden";
    return {
      ok: false,
      code: forbidden ? "forbidden" : "internal",
      message: forbidden ? "Owner only." : "Seeding failed and was rolled back.",
    };
  }
  revalidatePath(`/${organizationSlug}`, "layout");
  return { ok: true, data: { summary: (data ?? {}) as Record<string, number> } };
}
```

- [ ] **Step 7: Typecheck + full unit suite**

Run: `npm run typecheck && npm test`
Expected: both PASS. If `database.generated.ts` lacks the new RPC signatures and typecheck complains about `supabase.rpc("admin_clear_org_data", …)`, regenerate types the way this repo does (`supabase gen types typescript --local > src/types/database.generated.ts`) and include that file in the commit.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabase/admin.ts src/features/data-console src/types/database.generated.ts
git commit -m "feat(console): clear/seed server actions and console accounts"
```

---

### Task 4: Page, client UI, sidebar entry

**Files:**
- Create: `src/app/(seller)/[organizationSlug]/data-console/page.tsx`
- Create: `src/app/(seller)/[organizationSlug]/data-console/data-console-client.tsx`
- Modify: `src/features/dashboard/components/dashboard-shell-model.ts` (owner-only "Data console" entry)
- Test: `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts` (add cases)

**Interfaces:**
- Consumes: `clearAllData` / `seedDemoData` from `@/features/data-console/server/actions`; `CONSOLE_ACCOUNTS` from `@/features/data-console/lib/accounts`; `requireOrgRole`/`OrderPermissionError` from `@/features/orders/server/guards`; `getDashboardSidebarGroups({ organizationSlug, pathname, role })`.
- Produces: route `/[organizationSlug]/data-console` (404 for non-owners), sidebar group "System" with item "Data console" visible only when `role === "owner"`.

- [ ] **Step 1: Write the failing sidebar-model test**

Append to `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts` (inside the existing `getDashboardSidebarGroups` describe block, matching its call style):

```ts
  it("shows the Data console group to owners only", () => {
    const ownerGroups = getDashboardSidebarGroups({
      organizationSlug: "org",
      pathname: "/org/data-console",
      role: "owner",
    });
    const system = ownerGroups.find((g) => g.title === "System");
    expect(system?.items).toEqual([
      { title: "Data console", href: "/org/data-console", isActive: true },
    ]);

    for (const role of ["seller", "org_admin", undefined]) {
      const groups = getDashboardSidebarGroups({
        organizationSlug: "org",
        pathname: "/org/products",
        role,
      });
      expect(groups.find((g) => g.title === "System")).toBeUndefined();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/tests/unit/dashboard-shell-model.test.ts`
Expected: FAIL — no "System" group.

- [ ] **Step 3: Add the group in `dashboard-shell-model.ts`**

In `getDashboardSidebarGroups`, after the existing seller groups are built (the `SELLER_GROUPS.map(...)` return path), append conditionally:

```ts
  if (role === "owner") {
    const consoleHref = `/${organizationSlug}/data-console`;
    groups.push({
      title: "System",
      isActive: isRouteActive(pathname, consoleHref),
      items: [
        {
          title: "Data console",
          href: consoleHref,
          isActive: isRouteActive(pathname, consoleHref),
        },
      ],
    });
  }
  return groups;
```

(Adjust to the file's actual return shape: assign the mapped groups to a `groups` variable instead of returning the map expression directly.) If `app-sidebar.tsx` maps group icons via `groupIcons[group.title]`, add a "System" icon entry there (e.g. `Database` from lucide-react, following the existing icon imports).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/tests/unit/dashboard-shell-model.test.ts`
Expected: PASS (all existing cases too).

- [ ] **Step 5: Create the page (server component gate)**

`src/app/(seller)/[organizationSlug]/data-console/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { DataConsoleClient } from "./data-console-client";

export default async function DataConsolePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  try {
    await requireOrgRole(organizationSlug, ["owner"]);
  } catch (e) {
    if (e instanceof OrderPermissionError) notFound();
    throw e;
  }
  return <DataConsoleClient organizationSlug={organizationSlug} />;
}
```

- [ ] **Step 6: Create the client component**

`src/app/(seller)/[organizationSlug]/data-console/data-console-client.tsx`. Use the repo's existing UI primitives (check `src/components/ui/` for the exact exports; the dialogs below assume shadcn `AlertDialog`, `Button`, `Input`, `Card` — mirror how `runs-client.tsx` imports them). Behavior contract:

```tsx
"use client";

import { useState, useTransition } from "react";
import { clearAllData, seedDemoData } from "@/features/data-console/server/actions";
import { CONSOLE_ACCOUNTS } from "@/features/data-console/lib/accounts";

const CONFIRM_PHRASE = "PADAM SEMUA";

export function DataConsoleClient({ organizationSlug }: { organizationSlug: string }) {
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runClear() {
    startTransition(async () => {
      setMessage(null); setError(null);
      const result = await clearAllData(organizationSlug);
      if (result.ok) {
        const total = Object.values(result.data.counts).reduce((a, b) => a + b, 0);
        setMessage(`Cleared ${total} rows. Users were kept.`);
      } else {
        setError(result.message);
      }
      setConfirmText("");
    });
  }

  function runSeed() {
    startTransition(async () => {
      setMessage(null); setError(null);
      const result = await seedDemoData(organizationSlug);
      if (result.ok) {
        const s = result.data.summary;
        setMessage(
          `Seeded ${s.products} products, ${s.customers} customers, ${s.orders} orders, ${s.runs} runs.`,
        );
      } else {
        setError(result.message);
      }
    });
  }

  // Render two cards:
  // 1. "Clear all data" (destructive): explains users are kept; the button is
  //    disabled until confirmText === CONFIRM_PHRASE (input labelled
  //    `Type ${CONFIRM_PHRASE} to enable`); on click -> runClear().
  // 2. "Seed demo data": lists what gets created and the CONSOLE_ACCOUNTS
  //    emails; a confirm dialog stating "This clears existing data first",
  //    confirm -> runSeed().
  // Both show `message` (success, green) / `error` (destructive) below, and
  // disable their buttons while isPending.
}
```

Fill in the JSX with the project's card/button/input components and styling conventions (dark theme, matches other seller pages). No new dependencies.

- [ ] **Step 7: Verify in the browser**

Start the dev server via the launch config (Browser pane, `preview_start` with the configured name — never Bash). Log in as the local owner (`owner@gmail.com` / `test-only-password-12-chars` from `supabase/seed.sql`), open `/{org-slug}/data-console`:
1. Sidebar shows "System → Data console" for the owner.
2. Clear button disabled until `PADAM SEMUA` typed; after clearing, products page is empty but login still works.
3. Seed: success message with counts; products page shows 13 products **with images rendering** (this catches any image-path typo); orders kanban, tasks, dispatch, loading, runs pages all show data; login as `badrol@gmail.com` / `Password123!` works.
4. Log in as a non-owner (e.g. seed a seller or use the buyer) — `/data-console` 404s and no sidebar entry.

- [ ] **Step 8: Quality gates**

Run: `npm run typecheck && npm run lint && npm test && npm run db:test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/data-console" src/features/dashboard/components/dashboard-shell-model.ts src/features/dashboard/components/app-sidebar.tsx src/features/dashboard/tests/unit/dashboard-shell-model.test.ts
git commit -m "feat(console): owner-only data console page with clear and seed"
```

---

### Task 5: Final verification sweep

**Files:** none new.

- [ ] **Step 1: Full gate run**

Run: `npm run typecheck && npm run lint && npm test && npm run db:test`
Expected: all PASS.

- [ ] **Step 2: Fresh-database smoke**

Run: `supabase db reset`, then `npm run db:test` again.
Expected: PASS — proves the new migration applies cleanly from scratch alongside `seed.sql`.

- [ ] **Step 3: Spec cross-check**

Re-read `docs/superpowers/specs/2026-08-22-data-console-design.md`. Confirm each spec section maps to shipped code: clear scope (RPC delete list), seed dataset (13 products/10 customers/zones/bays/trucks/15 orders/2 runs/buyer orders), console accounts, page gating, type-to-confirm, error mapping, tests. Note any accepted deviations in the final report.

- [ ] **Step 4: Report**

Summarize for review (superpowers:requesting-code-review / finishing-a-development-branch decide merge next). No push without being asked.
