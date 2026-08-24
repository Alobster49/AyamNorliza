# Owner/Admin Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/dashboard` page for owner/org_admin/seller with sales KPIs, revenue chart, order funnel, improvement insights (price vs market, weight leakage, retention, delivery quality), an ops-today strip, and an admin panel.

**Architecture:** Three security-definer SQL RPCs return jsonb aggregates (data-console pattern: role check inside, explicit grants). Server actions in `src/features/dashboard/server/analytics-actions.ts` call them behind `requireOrgRole`. Pure model builders in `src/features/dashboard/analytics/` transform payloads into view models (unit-tested). A server page fetches everything in parallel and hands props to a client root that refetches sales/insights when the date range changes.

**Tech Stack:** Next.js App Router, Supabase (plpgsql RPCs, pgTAP), next-intl, shadcn ui components, recharts (new dep), vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-owner-dashboard-design.md`

## Global Constraints

- Dashboard roles = `MANAGER_ROLES` (`owner`, `org_admin`, `seller`) from `src/features/orders/lib/roles.ts`. RPCs enforce `has_org_role(p_organization_id, array['owner','org_admin','seller'])`, error `P0001` message `forbidden`.
- Revenue = `orders.total_amount` of orders with status `delivered` or `closed`, filtered/bucketed by `delivery_date`. Funnel counts use `created_at` converted to org timezone. Org timezone = `organizations.default_time_zone`, fallback `'Asia/Kuala_Lumpur'`. Never compute day boundaries in the browser.
- Every new SQL function: `security definer`, `set search_path = public, pg_temp`, then `revoke all ... from public; grant execute ... to authenticated;` (new functions get NO default grants — RLS alone yields 42501).
- All user-visible copy is key-based next-intl: new `analytics` namespace plus `dashboard.pages.dashboard`, added to **both** `src/messages/en.json` and `src/messages/ms.json` in the same task as the component. `src/messages/en.d.json.ts` is auto-generated (regenerates during `npm run dev` / `npm run build`) — never hand-edit it.
- Local DB workflow: `supabase start` once, then per migration: `npm run db:reset`, `npm run db:types` (commit the regenerated `src/types/database.generated.ts`), `npm run db:test` for pgTAP.
- Verify commands per task: `npm run lint`, `npm run typecheck`, `npm run test` (vitest unit), `npm run db:test` (pgTAP) when SQL changed.
- Client links: plain `next/link` with bare `/${organizationSlug}/...` hrefs (middleware adds locale). Server-side `redirect()` must be locale-prefixed via `await getLocale()` (see `(seller)/layout.tsx:45`).
- Dev server: run via Bash (`npm run dev`, port 9999) — `preview_start` resolves launch.json from the main checkout, not this worktree. `next.config.mjs` already pins the Turbopack root.
- Currency/number formatting in components: `useFormatter()` from next-intl (`format.number(x, { style: "currency", currency: "MYR" })`).
- Commit after every task with a conventional message.

---

### Task 1: `get_dashboard_sales` RPC + pgTAP

**Files:**
- Create: `supabase/tests/rls/24_dashboard_rpcs.sql`
- Create: `supabase/migrations/20260824000001_dashboard_sales_rpc.sql`

**Interfaces:**
- Produces: SQL function `public.get_dashboard_sales(p_organization_id uuid, p_from date, p_to date, p_bucket text default 'day') returns jsonb` with keys `kpis {revenue, orders, kg}`, `previous {revenue, orders, kg}`, `series [{bucket, revenue, orders}]`, `funnel {status: count}`, `topProducts [{name, revenue, kg}]`, `topCustomers [{name, revenue, orders}]`, `topZones [{name, revenue, orders}]`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/24_dashboard_rpcs.sql`. Fixture style copied from `08_order_rpcs.sql` (postgres-role inserts, then `set local role` + `request.jwt.claim.sub` to impersonate). Uses `d1...` uuids to avoid collisions with other test files.

```sql
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
        'd1000000-0000-0000-0000-000000000006', 'kg', 5, 1.0, 2.0, 'call', 5.000, 20.00)
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run db:reset && npm run db:test`
Expected: file 24 FAILS — `function public.get_dashboard_sales(uuid, date, date) does not exist` (the 42501 test errors with "does not exist" instead of a grant denial).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260824000001_dashboard_sales_rpc.sql`:

```sql
-- 20260824000001_dashboard_sales_rpc.sql
-- Owner/admin dashboard: sales aggregates for a date range.
-- Revenue basis: delivered/closed orders by delivery_date (spec
-- docs/superpowers/specs/2026-08-24-owner-dashboard-design.md).

begin;

create or replace function public.get_dashboard_sales(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_len integer := (p_to - p_from) + 1;
  v_prev_from date;
  v_prev_to date := p_from - 1;
  v_kpis jsonb;
  v_prev jsonb;
  v_series jsonb;
  v_funnel jsonb;
  v_products jsonb;
  v_customers jsonb;
  v_zones jsonb;
begin
  if not public.has_org_role(p_organization_id, array['owner','org_admin','seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_to < p_from or v_len > 400 then
    raise exception using errcode = 'P0001', message = 'invalid range';
  end if;
  if p_bucket not in ('day','week') then
    raise exception using errcode = 'P0001', message = 'invalid bucket';
  end if;

  v_prev_from := p_from - v_len;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;

  select jsonb_build_object(
    'revenue', coalesce(sum(o.total_amount), 0),
    'orders', count(*),
    'kg', coalesce((
      select sum(oi.final_weight_kg)
      from public.order_items oi
      join public.orders o2 on o2.id = oi.order_id
      where o2.organization_id = p_organization_id
        and o2.status in ('delivered','closed')
        and o2.delivery_date between p_from and p_to
        and not oi.is_cancelled
    ), 0))
  into v_kpis
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('delivered','closed')
    and o.delivery_date between p_from and p_to;

  select jsonb_build_object(
    'revenue', coalesce(sum(o.total_amount), 0),
    'orders', count(*),
    'kg', coalesce((
      select sum(oi.final_weight_kg)
      from public.order_items oi
      join public.orders o2 on o2.id = oi.order_id
      where o2.organization_id = p_organization_id
        and o2.status in ('delivered','closed')
        and o2.delivery_date between v_prev_from and v_prev_to
        and not oi.is_cancelled
    ), 0))
  into v_prev
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('delivered','closed')
    and o.delivery_date between v_prev_from and v_prev_to;

  select coalesce(jsonb_agg(
           jsonb_build_object('bucket', s.b, 'revenue', s.r, 'orders', s.n)
           order by s.b), '[]'::jsonb)
  into v_series
  from (
    select case when p_bucket = 'week'
                then date_trunc('week', o.delivery_date::timestamp)::date
                else o.delivery_date end as b,
           sum(o.total_amount) as r,
           count(*) as n
    from public.orders o
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by 1
  ) s;

  select coalesce(jsonb_object_agg(f.status, f.n), '{}'::jsonb)
  into v_funnel
  from (
    select o.status::text as status, count(*) as n
    from public.orders o
    where o.organization_id = p_organization_id
      and ((o.created_at at time zone v_tz)::date) between p_from and p_to
    group by o.status
  ) f;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'kg', t.kg)
           order by t.revenue desc), '[]'::jsonb)
  into v_products
  from (
    select p.name,
           sum(coalesce(oi.line_total, 0)) as revenue,
           sum(coalesce(oi.final_weight_kg, 0)) as kg
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
    group by p.name
    order by revenue desc
    limit 5
  ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'orders', t.n)
           order by t.revenue desc), '[]'::jsonb)
  into v_customers
  from (
    select c.name, sum(o.total_amount) as revenue, count(*) as n
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by c.name
    order by revenue desc
    limit 5
  ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'orders', t.n)
           order by t.revenue desc), '[]'::jsonb)
  into v_zones
  from (
    select z.name, sum(o.total_amount) as revenue, count(*) as n
    from public.orders o
    join public.delivery_zones z on z.id = o.zone_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by z.name
    order by revenue desc
    limit 5
  ) t;

  return jsonb_build_object(
    'kpis', v_kpis,
    'previous', v_prev,
    'series', v_series,
    'funnel', v_funnel,
    'topProducts', v_products,
    'topCustomers', v_customers,
    'topZones', v_zones
  );
end;
$$;

revoke all on function public.get_dashboard_sales(uuid, date, date, text) from public;
grant execute on function public.get_dashboard_sales(uuid, date, date, text) to authenticated;

commit;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run db:reset && npm run db:test`
Expected: all files PASS including 24 (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824000001_dashboard_sales_rpc.sql supabase/tests/rls/24_dashboard_rpcs.sql
git commit -m "feat(dashboard): get_dashboard_sales RPC with pgTAP coverage"
```

---

### Task 2: Date-range util + sales view model (pure TS, TDD)

**Files:**
- Create: `src/features/dashboard/analytics/date-range.ts`
- Create: `src/features/dashboard/analytics/sales-model.ts`
- Test: `src/features/dashboard/tests/unit/date-range.test.ts`
- Test: `src/features/dashboard/tests/unit/sales-model.test.ts`

**Interfaces:**
- Produces: `RangePreset = "today" | "7d" | "30d" | "90d"`; `resolveRange(preset: RangePreset, timeZone: string, now?: Date): { from: string; to: string }`; `bucketForRange(from: string, to: string): "day" | "week"`; `SalesPayload`, `SalesViewModel`, `KpiCell = { value: number; previous: number; deltaPct: number | null }`; `buildSalesViewModel(payload: SalesPayload, from: string, to: string, bucket: "day" | "week"): SalesViewModel`.

- [ ] **Step 1: Write failing tests**

`src/features/dashboard/tests/unit/date-range.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bucketForRange, resolveRange, shiftDate, todayInTimeZone } from "../../analytics/date-range";

// 2026-08-24T17:30 UTC is already 2026-08-25 01:30 in Kuala Lumpur (+8).
const now = new Date("2026-08-24T17:30:00.000Z");

describe("todayInTimeZone", () => {
  it("uses the org timezone day, not UTC", () => {
    expect(todayInTimeZone("Asia/Kuala_Lumpur", now)).toBe("2026-08-25");
    expect(todayInTimeZone("UTC", now)).toBe("2026-08-24");
  });
});

describe("shiftDate", () => {
  it("shifts across month boundaries", () => {
    expect(shiftDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftDate("2026-08-25", -6)).toBe("2026-08-19");
  });
});

describe("resolveRange", () => {
  it("today is a single-day range", () => {
    expect(resolveRange("today", "Asia/Kuala_Lumpur", now)).toEqual({
      from: "2026-08-25",
      to: "2026-08-25",
    });
  });
  it("7d spans 7 calendar days ending today", () => {
    expect(resolveRange("7d", "Asia/Kuala_Lumpur", now)).toEqual({
      from: "2026-08-19",
      to: "2026-08-25",
    });
  });
  it("30d and 90d span the right lengths", () => {
    expect(resolveRange("30d", "Asia/Kuala_Lumpur", now).from).toBe("2026-07-27");
    expect(resolveRange("90d", "Asia/Kuala_Lumpur", now).from).toBe("2026-05-28");
  });
});

describe("bucketForRange", () => {
  it("uses day buckets up to 59 days and week buckets from 60", () => {
    expect(bucketForRange("2026-08-01", "2026-08-30")).toBe("day");
    expect(bucketForRange("2026-06-01", "2026-08-25")).toBe("week");
  });
});
```

`src/features/dashboard/tests/unit/sales-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSalesViewModel, type SalesPayload } from "../../analytics/sales-model";

const payload: SalesPayload = {
  kpis: { revenue: 200, orders: 4, kg: 10 },
  previous: { revenue: 100, orders: 2, kg: 4 },
  series: [{ bucket: "2026-08-02", revenue: 200, orders: 4 }],
  funnel: { pending: 3, delivered: 4, cancelled: 1 },
  topProducts: [{ name: "Whole Chicken", revenue: 150, kg: 7 }],
  topCustomers: [{ name: "Kak Jah", revenue: 120, orders: 2 }],
  topZones: [{ name: "Zon A", revenue: 200, orders: 4 }],
};

describe("buildSalesViewModel", () => {
  const vm = buildSalesViewModel(payload, "2026-08-01", "2026-08-03", "day");

  it("computes deltas against the previous period", () => {
    expect(vm.revenue).toEqual({ value: 200, previous: 100, deltaPct: 100 });
    expect(vm.orders.deltaPct).toBe(100);
  });

  it("derives AOV and RM/kg, with zero-safe previous", () => {
    expect(vm.aov.value).toBe(50); // 200 / 4
    expect(vm.rmPerKg.value).toBe(20); // 200 / 10
    const empty = buildSalesViewModel(
      { ...payload, kpis: { revenue: 0, orders: 0, kg: 0 }, previous: { revenue: 0, orders: 0, kg: 0 } },
      "2026-08-01", "2026-08-03", "day",
    );
    expect(empty.aov.value).toBe(0);
    expect(empty.revenue.deltaPct).toBeNull(); // previous 0 -> no delta
  });

  it("fills day-bucket gaps with zero rows", () => {
    expect(vm.series).toEqual([
      { bucket: "2026-08-01", revenue: 0, orders: 0 },
      { bucket: "2026-08-02", revenue: 200, orders: 4 },
      { bucket: "2026-08-03", revenue: 0, orders: 0 },
    ]);
  });

  it("orders the funnel and computes the cancellation rate", () => {
    expect(vm.funnel.map((f) => f.status)).toEqual([
      "pending", "confirmed", "ready", "delivered", "closed", "cancelled",
    ]);
    expect(vm.funnel[0]).toEqual({ status: "pending", count: 3 });
    expect(vm.cancellationRate).toBeCloseTo(1 / 8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/features/dashboard`
Expected: FAIL — cannot resolve `../../analytics/date-range` / `sales-model`.

- [ ] **Step 3: Implement**

`src/features/dashboard/analytics/date-range.ts`:

```ts
/**
 * Date-range helpers for the analytics dashboard. All ranges are inclusive
 * ISO dates (YYYY-MM-DD) in the organization's timezone; day boundaries are
 * never derived in the browser's locale.
 */

export type RangePreset = "today" | "7d" | "30d" | "90d";

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const PRESET_DAYS: Record<Exclude<RangePreset, "today">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function resolveRange(
  preset: RangePreset,
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = todayInTimeZone(timeZone, now);
  if (preset === "today") return { from: today, to: today };
  return { from: shiftDate(today, -(PRESET_DAYS[preset] - 1)), to: today };
}

export function rangeLengthDays(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function bucketForRange(from: string, to: string): "day" | "week" {
  return rangeLengthDays(from, to) >= 60 ? "week" : "day";
}
```

`src/features/dashboard/analytics/sales-model.ts`:

```ts
import { rangeLengthDays, shiftDate } from "./date-range";

export type SalesKpis = { revenue: number; orders: number; kg: number };
export type SeriesPoint = { bucket: string; revenue: number; orders: number };
export type TopProduct = { name: string; revenue: number; kg: number };
export type TopParty = { name: string; revenue: number; orders: number };

/** Raw jsonb payload of the get_dashboard_sales RPC. */
export type SalesPayload = {
  kpis: SalesKpis;
  previous: SalesKpis;
  series: SeriesPoint[];
  funnel: Record<string, number>;
  topProducts: TopProduct[];
  topCustomers: TopParty[];
  topZones: TopParty[];
};

export type KpiCell = { value: number; previous: number; deltaPct: number | null };

export const FUNNEL_ORDER = [
  "pending",
  "confirmed",
  "ready",
  "delivered",
  "closed",
  "cancelled",
] as const;
export type FunnelStatus = (typeof FUNNEL_ORDER)[number];

export type SalesViewModel = {
  revenue: KpiCell;
  orders: KpiCell;
  kg: KpiCell;
  aov: KpiCell;
  rmPerKg: KpiCell;
  series: SeriesPoint[];
  funnel: Array<{ status: FunnelStatus; count: number }>;
  cancellationRate: number;
  topProducts: TopProduct[];
  topCustomers: TopParty[];
  topZones: TopParty[];
};

function cell(value: number, previous: number): KpiCell {
  return {
    value,
    previous,
    deltaPct: previous > 0 ? ((value - previous) / previous) * 100 : null,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function fillDaySeries(series: SeriesPoint[], from: string, to: string): SeriesPoint[] {
  const byBucket = new Map(series.map((p) => [p.bucket, p]));
  const out: SeriesPoint[] = [];
  const days = rangeLengthDays(from, to);
  for (let i = 0; i < days; i += 1) {
    const bucket = shiftDate(from, i);
    out.push(byBucket.get(bucket) ?? { bucket, revenue: 0, orders: 0 });
  }
  return out;
}

export function buildSalesViewModel(
  payload: SalesPayload,
  from: string,
  to: string,
  bucket: "day" | "week",
): SalesViewModel {
  const { kpis, previous } = payload;
  const funnelTotal = Object.values(payload.funnel).reduce((a, b) => a + b, 0);

  return {
    revenue: cell(kpis.revenue, previous.revenue),
    orders: cell(kpis.orders, previous.orders),
    kg: cell(kpis.kg, previous.kg),
    aov: cell(ratio(kpis.revenue, kpis.orders), ratio(previous.revenue, previous.orders)),
    rmPerKg: cell(ratio(kpis.revenue, kpis.kg), ratio(previous.revenue, previous.kg)),
    series: bucket === "day" ? fillDaySeries(payload.series, from, to) : payload.series,
    funnel: FUNNEL_ORDER.map((status) => ({
      status,
      count: payload.funnel[status] ?? 0,
    })),
    cancellationRate: ratio(payload.funnel.cancelled ?? 0, funnelTotal),
    topProducts: payload.topProducts,
    topCustomers: payload.topCustomers,
    topZones: payload.topZones,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/features/dashboard` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/analytics src/features/dashboard/tests
git commit -m "feat(dashboard): date-range and sales view-model builders"
```

---

### Task 3: Server actions, page scaffold, sidebar entry, KPI row, i18n

**Files:**
- Create: `src/features/dashboard/server/analytics-actions.ts`
- Create: `src/app/[locale]/(seller)/[organizationSlug]/dashboard/page.tsx`
- Create: `src/features/dashboard/analytics/components/analytics-dashboard.tsx`
- Create: `src/features/dashboard/analytics/components/range-picker.tsx`
- Create: `src/features/dashboard/analytics/components/kpi-row.tsx`
- Create: `src/features/dashboard/analytics/components/section-error.tsx`
- Modify: `src/features/dashboard/components/dashboard-shell-model.ts:29-39` (add Dashboard item)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (add keys)
- Modify: `src/types/database.generated.ts` (regenerated, committed)
- Test: `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts` — extend if it exists; if it does not exist, skip (sidebar covered by e2e `dashboard-shell.spec.ts` — grep it for nav-item assertions and add "Dashboard" where the spec enumerates Sales items).

**Interfaces:**
- Consumes: `resolveRange`, `bucketForRange`, `buildSalesViewModel`, `SalesPayload` (Task 2); `requireOrgRole`, `OrderPermissionError` from `@/features/orders/server/guards`; `MANAGER_ROLES` from `@/features/orders/lib/roles`.
- Produces: `getDashboardSales(organizationSlug: string, from: string, to: string, bucket: "day" | "week"): Promise<ActionResult<SalesPayload>>` where `ActionResult<T> = { ok: true; data: T } | { ok: false; message: string }` (exported from analytics-actions); client component `AnalyticsDashboard` with props `{ organizationSlug: string; timeZone: string; initialRange: { from: string; to: string }; initialSales: SalesPayload | null }`.

- [ ] **Step 1: Regenerate DB types**

Run: `npm run db:types`
Expected: `src/types/database.generated.ts` gains a `get_dashboard_sales` entry under Functions.

- [ ] **Step 2: Server action**

`src/features/dashboard/server/analytics-actions.ts`:

```ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import type { SalesPayload } from "../analytics/sales-model";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function callDashboardRpc<T>(
  organizationSlug: string,
  rpcName: "get_dashboard_sales",
  args: Record<string, unknown>,
): Promise<ActionResult<T>> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) return { ok: false, message: error.message };
    throw error;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(rpcName, {
    p_organization_id: orgId,
    ...args,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, data: data as T };
}

export async function getDashboardSales(
  organizationSlug: string,
  from: string,
  to: string,
  bucket: "day" | "week",
): Promise<ActionResult<SalesPayload>> {
  return callDashboardRpc<SalesPayload>(organizationSlug, "get_dashboard_sales", {
    p_from: from,
    p_to: to,
    p_bucket: bucket,
  });
}
```

(`callDashboardRpc`'s `rpcName` union widens in Tasks 5/7 as the other RPCs land.)

- [ ] **Step 3: i18n keys**

In `src/messages/en.json`, add `"dashboard"` under `dashboard.pages` (keep alphabetical position irrelevant — put it first to match nav order):

```json
"pages": {
  "dashboard": "Dashboard",
  "products": "Products",
  ...
```

Add a new top-level `analytics` namespace (after `dashboard`):

```json
"analytics": {
  "title": "Dashboard",
  "range": {
    "today": "Today",
    "7d": "7 days",
    "30d": "30 days",
    "90d": "90 days",
    "custom": "Custom",
    "vsPrevious": "vs previous period"
  },
  "kpi": {
    "revenue": "Sales",
    "orders": "Orders",
    "kg": "Kg sold",
    "aov": "Avg order value",
    "rmPerKg": "Realized RM/kg"
  },
  "sectionError": "This section failed to load.",
  "empty": "No data for this period yet."
}
```

In `src/messages/ms.json`, mirror both:

```json
"pages": {
  "dashboard": "Papan pemuka",
  ...
```

```json
"analytics": {
  "title": "Papan pemuka",
  "range": {
    "today": "Hari ini",
    "7d": "7 hari",
    "30d": "30 hari",
    "90d": "90 hari",
    "custom": "Julat sendiri",
    "vsPrevious": "berbanding tempoh sebelumnya"
  },
  "kpi": {
    "revenue": "Jualan",
    "orders": "Pesanan",
    "kg": "Kg dijual",
    "aov": "Purata nilai pesanan",
    "rmPerKg": "RM/kg sebenar"
  },
  "sectionError": "Bahagian ini gagal dimuatkan.",
  "empty": "Belum ada data untuk tempoh ini."
}
```

- [ ] **Step 4: Sidebar entry**

In `src/features/dashboard/components/dashboard-shell-model.ts`, add as the FIRST item of the Sales group (line 30):

```ts
      { title: "Dashboard", titleKey: "pages.dashboard", segment: "dashboard" },
```

- [ ] **Step 5: Components + page**

`src/features/dashboard/analytics/components/section-error.tsx`:

```tsx
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";

export function SectionError() {
  const t = useTranslations("analytics");
  return (
    <Card>
      <CardContent className="py-6 text-sm text-muted-foreground">
        {t("sectionError")}
      </CardContent>
    </Card>
  );
}
```

`src/features/dashboard/analytics/components/range-picker.tsx` (preset buttons only; custom range added in Task 9):

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { RangePreset } from "../date-range";

const PRESETS: RangePreset[] = ["today", "7d", "30d", "90d"];

export function RangePicker({
  active,
  onSelect,
  disabled,
}: {
  active: RangePreset | "custom";
  onSelect: (preset: RangePreset) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("analytics.range");
  return (
    <div className="flex flex-wrap gap-1">
      {PRESETS.map((preset) => (
        <Button
          key={preset}
          size="sm"
          variant={active === preset ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onSelect(preset)}
        >
          {t(preset)}
        </Button>
      ))}
    </div>
  );
}
```

`src/features/dashboard/analytics/components/kpi-row.tsx`:

```tsx
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiCell, SalesViewModel } from "../sales-model";

function Delta({ cell }: { cell: KpiCell }) {
  const t = useTranslations("analytics.range");
  const format = useFormatter();
  if (cell.deltaPct === null) return null;
  const up = cell.deltaPct >= 0;
  return (
    <p className={`text-xs ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {format.number(Math.abs(cell.deltaPct) / 100, { style: "percent", maximumFractionDigits: 1 })}{" "}
      <span className="text-muted-foreground">{t("vsPrevious")}</span>
    </p>
  );
}

export function KpiRow({ vm }: { vm: SalesViewModel }) {
  const t = useTranslations("analytics.kpi");
  const format = useFormatter();
  const money = (n: number) => format.number(n, { style: "currency", currency: "MYR" });
  const cells: Array<{ key: string; label: string; cell: KpiCell; render: (n: number) => string }> = [
    { key: "revenue", label: t("revenue"), cell: vm.revenue, render: money },
    { key: "orders", label: t("orders"), cell: vm.orders, render: (n) => format.number(n) },
    { key: "kg", label: t("kg"), cell: vm.kg, render: (n) => format.number(n, { maximumFractionDigits: 1 }) },
    { key: "aov", label: t("aov"), cell: vm.aov, render: money },
    { key: "rmPerKg", label: t("rmPerKg"), cell: vm.rmPerKg, render: money },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {cells.map(({ key, label, cell, render }) => (
        <Card key={key}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{render(cell.value)}</p>
            <Delta cell={cell} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

`src/features/dashboard/analytics/components/analytics-dashboard.tsx` (client root; chart/funnel/insights slots grow in later tasks):

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { getDashboardSales } from "@/features/dashboard/server/analytics-actions";
import { bucketForRange, resolveRange, type RangePreset } from "../date-range";
import { buildSalesViewModel, type SalesPayload } from "../sales-model";
import { KpiRow } from "./kpi-row";
import { RangePicker } from "./range-picker";
import { SectionError } from "./section-error";

type Props = {
  organizationSlug: string;
  timeZone: string;
  initialRange: { from: string; to: string };
  initialSales: SalesPayload | null;
};

export function AnalyticsDashboard({ organizationSlug, timeZone, initialRange, initialSales }: Props) {
  const t = useTranslations("analytics");
  const [preset, setPreset] = useState<RangePreset | "custom">("30d");
  const [range, setRange] = useState(initialRange);
  const [sales, setSales] = useState<SalesPayload | null>(initialSales);
  const [salesError, setSalesError] = useState(initialSales === null);
  const [isPending, startTransition] = useTransition();

  const bucket = bucketForRange(range.from, range.to);
  const salesVm = useMemo(
    () => (sales ? buildSalesViewModel(sales, range.from, range.to, bucket) : null),
    [sales, range, bucket],
  );

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    startTransition(async () => {
      const result = await getDashboardSales(
        organizationSlug, next.from, next.to, bucketForRange(next.from, next.to),
      );
      if (result.ok) {
        setSales(result.data);
        setSalesError(false);
      } else {
        setSalesError(true);
      }
    });
  }

  function onPreset(next: RangePreset) {
    setPreset(next);
    applyRange(resolveRange(next, timeZone));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <RangePicker active={preset} onSelect={onPreset} disabled={isPending} />
      </div>
      {salesVm ? <KpiRow vm={salesVm} /> : <SectionError />}
    </div>
  );
}
```

`src/app/[locale]/(seller)/[organizationSlug]/dashboard/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { getDashboardSales } from "@/features/dashboard/server/analytics-actions";
import { bucketForRange, resolveRange } from "@/features/dashboard/analytics/date-range";
import { AnalyticsDashboard } from "@/features/dashboard/analytics/components/analytics-dashboard";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let timeZone: string;
  try {
    ({ timeZone } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${await getLocale()}/${organizationSlug}`);
    }
    throw error;
  }

  const initialRange = resolveRange("30d", timeZone);
  const sales = await getDashboardSales(
    organizationSlug,
    initialRange.from,
    initialRange.to,
    bucketForRange(initialRange.from, initialRange.to),
  );

  return (
    <AnalyticsDashboard
      organizationSlug={organizationSlug}
      timeZone={timeZone}
      initialRange={initialRange}
      initialSales={sales.ok ? sales.data : null}
    />
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run dev` (Bash, background), open `http://localhost:9999/<locale>/<org>/dashboard` as an owner (seed an org first via data console if the local DB is empty). Check: sidebar shows Dashboard first in Sales; KPI row renders; preset buttons refetch. Then stop dev server; run `npm run lint && npm run typecheck && npm run test`.
Expected: all pass. (`npm run dev` regenerates `en.d.json.ts` for the new keys — commit it.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dashboard): dashboard page with KPI row, range presets, sidebar entry"
```

---

### Task 4: Revenue chart + funnel card

**Files:**
- Create: `src/features/dashboard/analytics/components/revenue-chart.tsx`
- Create: `src/features/dashboard/analytics/components/funnel-card.tsx`
- Modify: `src/features/dashboard/analytics/components/analytics-dashboard.tsx` (mount both)
- Modify: `package.json` (recharts)

**Interfaces:**
- Consumes: `SalesViewModel.series`, `.funnel`, `.cancellationRate` (Task 2); `status.order.*` message keys (existing).

- [ ] **Step 1: Install recharts**

```bash
npm install recharts
```

- [ ] **Step 2: Chart component**

`src/features/dashboard/analytics/components/revenue-chart.tsx`:

```tsx
"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SeriesPoint } from "../sales-model";

export function RevenueChart({ series }: { series: SeriesPoint[] }) {
  const t = useTranslations("analytics");
  const format = useFormatter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("chart.title")}</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11 }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              width={56}
              tickFormatter={(v: number) => format.number(v, { notation: "compact" })}
            />
            <Tooltip
              formatter={(value: number) => [
                format.number(value, { style: "currency", currency: "MYR" }),
                t("kpi.revenue"),
              ]}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--primary)"
              fill="var(--primary)"
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
```

(Verify `--primary` and `--border` exist in `src/app/globals.css`; if the tokens are named differently there, use the actual names.)

- [ ] **Step 3: Funnel card**

`src/features/dashboard/analytics/components/funnel-card.tsx`:

```tsx
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalesViewModel } from "../sales-model";

export function FunnelCard({ vm }: { vm: SalesViewModel }) {
  const t = useTranslations("analytics");
  const tStatus = useTranslations("status.order");
  const format = useFormatter();
  const max = Math.max(1, ...vm.funnel.map((f) => f.count));
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">{t("funnel.title")}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {t("funnel.cancellationRate")}{" "}
          {format.number(vm.cancellationRate, { style: "percent", maximumFractionDigits: 1 })}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {vm.funnel.map(({ status, count }) => (
          <div key={status} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{tStatus(status)}</span>
            <div className="h-4 flex-1 rounded bg-muted">
              <div
                className={`h-4 rounded ${status === "cancelled" ? "bg-red-400" : "bg-primary"}`}
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs tabular-nums">{format.number(count)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Mount + i18n keys**

In `analytics-dashboard.tsx`, below `<KpiRow />` (inside the `salesVm ?` branch — wrap both in a fragment):

```tsx
<div className="grid gap-4 lg:grid-cols-2">
  <RevenueChart series={salesVm.series} />
  <FunnelCard vm={salesVm} />
</div>
```

Add to `analytics` in `en.json`:

```json
"chart": { "title": "Sales trend" },
"funnel": { "title": "Order funnel", "cancellationRate": "Cancellation rate" }
```

`ms.json`:

```json
"chart": { "title": "Trend jualan" },
"funnel": { "title": "Corong pesanan", "cancellationRate": "Kadar batal" }
```

- [ ] **Step 5: Verify**

Run: `npm run dev`, reload the page — chart + funnel render, no console errors. Then `npm run lint && npm run typecheck && npm run test`.
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(dashboard): revenue trend chart and order funnel card"
```

---

### Task 5: `get_dashboard_today` RPC + pgTAP

**Files:**
- Create: `supabase/migrations/20260824000002_dashboard_today_rpc.sql`
- Modify: `supabase/tests/rls/24_dashboard_rpcs.sql` (bump `plan(5)` → `plan(8)`, append tests)

**Interfaces:**
- Produces: `public.get_dashboard_today(p_organization_id uuid) returns jsonb` with keys `date`, `runs [{id, truckName, truckCode, status, ordersTotal, delivered, failed}]`, `tasksPending`, `tasksDoneToday`, `ordersWithoutRun`, `marketPriceDate`, `marketStale`.

- [ ] **Step 1: Append failing pgTAP tests**

In `24_dashboard_rpcs.sql`, change `select plan(5);` to `select plan(8);`. Append fixture (before the role-switching sections — pgTAP runs top-down, keep all fixtures together at the top): a run today plus a task:

```sql
insert into public.delivery_runs (id, organization_id, truck_id, run_date, status)
values ('d1000000-0000-0000-0000-000000000030', 'd1000000-0000-0000-0000-00000000000a',
        'd1000000-0000-0000-0000-000000000008', (now() at time zone 'Asia/Kuala_Lumpur')::date, 'planned')
on conflict (id) do nothing;

update public.orders set run_id = 'd1000000-0000-0000-0000-000000000030'
where id = 'd1000000-0000-0000-0000-000000000010';

insert into public.order_tasks (id, organization_id, order_id, status)
values ('d1000000-0000-0000-0000-000000000040', 'd1000000-0000-0000-0000-00000000000a',
        'd1000000-0000-0000-0000-000000000011', 'pending')
on conflict (id) do nothing;
```

Append at the end (owner is still impersonated from the sales tests — re-assert the role anyway for clarity):

```sql
set local role authenticated;
set local "request.jwt.claim.sub" to 'd1000000-0000-0000-0000-000000000001';

select ok(
  (select public.get_dashboard_today('d1000000-0000-0000-0000-00000000000a'))
    ?& array['date','runs','tasksPending','tasksDoneToday','ordersWithoutRun','marketPriceDate','marketStale'],
  'today payload has all keys');

select is(
  (select public.get_dashboard_today('d1000000-0000-0000-0000-00000000000a') ->> 'tasksPending')::integer,
  1, 'one pending warehouse task');

select is(
  jsonb_array_length(
    (select public.get_dashboard_today('d1000000-0000-0000-0000-00000000000a') -> 'runs')),
  1, 'one run today');
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run db:reset && npm run db:test`
Expected: file 24 FAILS — `function public.get_dashboard_today(uuid) does not exist`.

- [ ] **Step 3: Migration**

`supabase/migrations/20260824000002_dashboard_today_rpc.sql`:

```sql
-- 20260824000002_dashboard_today_rpc.sql
-- Owner/admin dashboard: today's operations snapshot (org-timezone day).

begin;

create or replace function public.get_dashboard_today(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_today date;
  v_runs jsonb;
  v_tasks_pending integer;
  v_tasks_done_today integer;
  v_orders_without_run integer;
  v_market_date date;
begin
  if not public.has_org_role(p_organization_id, array['owner','org_admin','seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;

  v_today := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'truckName', t.name,
           'truckCode', t.code,
           'status', r.status,
           'ordersTotal', (select count(*) from public.orders o where o.run_id = r.id),
           'delivered', (select count(*) from public.orders o
                         where o.run_id = r.id and o.status in ('delivered','closed')),
           'failed', (select count(*) from public.orders o
                      where o.run_id = r.id and (
                        select da.outcome::text from public.delivery_attempts da
                        where da.order_id = o.id and da.run_id = r.id
                        order by da.attempted_at desc limit 1) = 'failed')
         ) order by t.code), '[]'::jsonb)
  into v_runs
  from public.delivery_runs r
  join public.trucks t on t.id = r.truck_id
  where r.organization_id = p_organization_id
    and r.run_date = v_today;

  select count(*) into v_tasks_pending
  from public.order_tasks ot
  where ot.organization_id = p_organization_id and ot.status = 'pending';

  select count(*) into v_tasks_done_today
  from public.order_tasks ot
  where ot.organization_id = p_organization_id
    and ot.status = 'done'
    and ot.done_at is not null
    and ((ot.done_at at time zone v_tz)::date) = v_today;

  select count(*) into v_orders_without_run
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('confirmed','ready')
    and o.run_id is null
    and o.delivery_date = v_today;

  select max(mp.price_date) into v_market_date from public.market_prices mp;

  return jsonb_build_object(
    'date', v_today,
    'runs', v_runs,
    'tasksPending', v_tasks_pending,
    'tasksDoneToday', v_tasks_done_today,
    'ordersWithoutRun', v_orders_without_run,
    'marketPriceDate', v_market_date,
    'marketStale', (v_market_date is null or v_market_date < v_today - 3)
  );
end;
$$;

revoke all on function public.get_dashboard_today(uuid) from public;
grant execute on function public.get_dashboard_today(uuid) to authenticated;

commit;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run db:reset && npm run db:test`
Expected: all PASS (file 24: 8 tests). Then `npm run db:types` and commit the regenerated file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): get_dashboard_today RPC with pgTAP coverage"
```

---

### Task 6: Today strip + admin panel (move summary-model into dashboard feature)

**Files:**
- Create: `src/features/dashboard/analytics/today-model.ts`
- Create: `src/features/dashboard/analytics/components/today-strip.tsx`
- Create: `src/features/dashboard/analytics/components/admin-panel.tsx`
- Create: `src/features/dashboard/analytics/admin-summary-model.ts` (moved + stripped from `src/features/overview/summary-model.ts`)
- Move test: `src/features/overview/tests/unit/summary-model.test.ts` → `src/features/dashboard/tests/unit/admin-summary-model.test.ts`
- Delete: `src/features/overview/` (rest of the feature — its components import the moved summary-model)
- Test: `src/features/dashboard/tests/unit/today-model.test.ts`
- Modify: `analytics-actions.ts` (add `getDashboardToday`), `page.tsx`, `analytics-dashboard.tsx`, `en.json`, `ms.json`

**Interfaces:**
- Consumes: `get_dashboard_today` RPC (Task 5); `listMembers/listInvitations/listAccessReviews/listSupportSessions/listAuditLog` from `@/features/identity-access/server/queries`.
- Produces: `TodayPayload`, `buildTodayViewModel(payload: TodayPayload): TodayViewModel`; `buildAdminSummary(rows: AdminSummaryRows, now?: Date): AdminSummary` — the old `buildOverviewDashboardSummary` minus the `operations` field and mock `operationsSnapshot` (delete `OperationsSnapshot` type, `operationsSnapshot` const, the trend/flock data; keep identity aggregation and the four priority builders; keep priority `href`s relative like `/settings/users` — the panel prefixes `/${organizationSlug}`). Props for `AnalyticsDashboard` gain `today: TodayPayload | null; adminSummary: AdminSummary | null`.

- [ ] **Step 1: Failing test for today-model**

`src/features/dashboard/tests/unit/today-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTodayViewModel, type TodayPayload } from "../../analytics/today-model";

const payload: TodayPayload = {
  date: "2026-08-24",
  runs: [
    { id: "r1", truckName: "Alpha", truckCode: "A", status: "departed", ordersTotal: 10, delivered: 6, failed: 1 },
  ],
  tasksPending: 3,
  tasksDoneToday: 5,
  ordersWithoutRun: 2,
  marketPriceDate: "2026-08-20",
  marketStale: true,
};

describe("buildTodayViewModel", () => {
  const vm = buildTodayViewModel(payload);
  it("computes run progress", () => {
    expect(vm.runs[0].progressPct).toBe(60);
  });
  it("collects alerts for unassigned orders and stale market prices", () => {
    expect(vm.alerts).toEqual([
      { kind: "ordersWithoutRun", count: 2 },
      { kind: "marketStale", count: 0 },
    ]);
  });
  it("emits no alerts when everything is fine", () => {
    const fine = buildTodayViewModel({ ...payload, ordersWithoutRun: 0, marketStale: false });
    expect(fine.alerts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/features/dashboard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement today-model**

`src/features/dashboard/analytics/today-model.ts`:

```ts
export type TodayRun = {
  id: string;
  truckName: string;
  truckCode: string;
  status: "planned" | "departed" | "completed";
  ordersTotal: number;
  delivered: number;
  failed: number;
};

export type TodayPayload = {
  date: string;
  runs: TodayRun[];
  tasksPending: number;
  tasksDoneToday: number;
  ordersWithoutRun: number;
  marketPriceDate: string | null;
  marketStale: boolean;
};

export type TodayAlert = { kind: "ordersWithoutRun" | "marketStale"; count: number };

export type TodayViewModel = {
  date: string;
  runs: Array<TodayRun & { progressPct: number }>;
  tasksPending: number;
  tasksDoneToday: number;
  alerts: TodayAlert[];
};

export function buildTodayViewModel(payload: TodayPayload): TodayViewModel {
  const alerts: TodayAlert[] = [];
  if (payload.ordersWithoutRun > 0) {
    alerts.push({ kind: "ordersWithoutRun", count: payload.ordersWithoutRun });
  }
  if (payload.marketStale) alerts.push({ kind: "marketStale", count: 0 });
  return {
    date: payload.date,
    runs: payload.runs.map((run) => ({
      ...run,
      progressPct: run.ordersTotal > 0 ? Math.round((run.delivered / run.ordersTotal) * 100) : 0,
    })),
    tasksPending: payload.tasksPending,
    tasksDoneToday: payload.tasksDoneToday,
    alerts,
  };
}
```

Run: `npm run test -- src/features/dashboard` — PASS.

- [ ] **Step 4: Move summary-model, delete the rest of the overview feature**

`overview-presentation.ts` and `operations-overview-client.tsx` import `../summary-model`, so the move and the deletion must land together or typecheck breaks:

```bash
git mv src/features/overview/summary-model.ts src/features/dashboard/analytics/admin-summary-model.ts
git mv src/features/overview/tests/unit/summary-model.test.ts src/features/dashboard/tests/unit/admin-summary-model.test.ts
git rm -r src/features/overview
```

(The second `git rm` also drops `overview-presentation.test.ts` — it only tests the mock presentation layer.)

Edit `admin-summary-model.ts`: delete `OperationsPriorityItem.category` value `"operations"` usages stay fine — delete the `OperationsSnapshot` type, the `operationsSnapshot` const, and the `operations` field of the summary; rename `OverviewDashboardSummary` → `AdminSummary`, `OverviewDashboardRows` → `AdminSummaryRows`, `buildOverviewDashboardSummary` → `buildAdminSummary`; in the return, drop `operations` and the `...operationsSnapshot.priorityItems` spread. Update the moved test's imports/names and remove any assertions on `operations`/flock data (keep the identity + priority assertions). Run `npm run test -- src/features/dashboard` — PASS.

- [ ] **Step 5: Action + i18n + components + wiring**

Add to `analytics-actions.ts` (widen `rpcName` union to `"get_dashboard_sales" | "get_dashboard_today"`):

```ts
import type { TodayPayload } from "../analytics/today-model";

export async function getDashboardToday(
  organizationSlug: string,
): Promise<ActionResult<TodayPayload>> {
  return callDashboardRpc<TodayPayload>(organizationSlug, "get_dashboard_today", {});
}
```

`en.json` additions under `analytics`:

```json
"today": {
  "title": "Today's operations",
  "runs": "Delivery runs",
  "noRuns": "No runs scheduled today.",
  "tasksPending": "Tasks pending",
  "tasksDoneToday": "Tasks done today",
  "failedStops": "{count} failed",
  "alerts": {
    "ordersWithoutRun": "{count} orders for today have no delivery run",
    "marketStale": "Market prices have not synced for 3+ days"
  }
},
"admin": {
  "title": "Admin",
  "activeMembers": "Active members",
  "pendingInvitations": "Pending invitations",
  "openAccessReviews": "Open access reviews",
  "activeSupportSessions": "Active support sessions",
  "priorities": "Needs attention",
  "allClear": "Nothing needs attention."
}
```

`ms.json`:

```json
"today": {
  "title": "Operasi hari ini",
  "runs": "Trip penghantaran",
  "noRuns": "Tiada trip dijadualkan hari ini.",
  "tasksPending": "Tugasan belum siap",
  "tasksDoneToday": "Tugasan siap hari ini",
  "failedStops": "{count} gagal",
  "alerts": {
    "ordersWithoutRun": "{count} pesanan hari ini belum ada trip penghantaran",
    "marketStale": "Harga pasaran tidak dikemas kini 3+ hari"
  }
},
"admin": {
  "title": "Pentadbiran",
  "activeMembers": "Ahli aktif",
  "pendingInvitations": "Jemputan menunggu",
  "openAccessReviews": "Semakan akses terbuka",
  "activeSupportSessions": "Sesi sokongan aktif",
  "priorities": "Perlu perhatian",
  "allClear": "Tiada apa yang perlu perhatian."
}
```

`today-strip.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildTodayViewModel, type TodayPayload } from "../today-model";

export function TodayStrip({ payload }: { payload: TodayPayload }) {
  const t = useTranslations("analytics.today");
  const tRun = useTranslations("status.run");
  const vm = buildTodayViewModel(payload);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {vm.alerts.length > 0 && (
          <div className="flex flex-col gap-1">
            {vm.alerts.map((alert) => (
              <p key={alert.kind} className="flex items-center gap-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t(`alerts.${alert.kind}`, { count: alert.count })}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          <span>{t("tasksPending")}: <strong className="tabular-nums">{vm.tasksPending}</strong></span>
          <span>{t("tasksDoneToday")}: <strong className="tabular-nums">{vm.tasksDoneToday}</strong></span>
        </div>
        {vm.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRuns")}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {vm.runs.map((run) => (
              <div key={run.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{run.truckName} ({run.truckCode})</span>
                  <Badge variant="outline">{tRun(run.status)}</Badge>
                </div>
                <div className="mt-1 h-2 rounded bg-muted">
                  <div className="h-2 rounded bg-primary" style={{ width: `${run.progressPct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {run.delivered}/{run.ordersTotal}
                  {run.failed > 0 ? ` · ${t("failedStops", { count: run.failed })}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

`admin-panel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "../admin-summary-model";

export function AdminPanel({
  summary,
  organizationSlug,
}: {
  summary: AdminSummary;
  organizationSlug: string;
}) {
  const t = useTranslations("analytics.admin");
  const stats = [
    { key: "activeMembers", value: summary.identity.activeMembers },
    { key: "pendingInvitations", value: summary.identity.pendingInvitations },
    { key: "openAccessReviews", value: summary.identity.openAccessReviews },
    { key: "activeSupportSessions", value: summary.identity.activeSupportSessions },
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {stats.map(({ key, value }) => (
            <div key={key} className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">{t(key)}</p>
              <p className="text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs font-medium text-muted-foreground">{t("priorities")}</p>
        {summary.priorityItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("allClear")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {summary.priorityItems.slice(0, 5).map((item) => (
              <li key={item.id} className="text-sm">
                {item.href ? (
                  <Link className="underline-offset-2 hover:underline" href={`/${organizationSlug}${item.href}`}>
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}{" "}
                <span className="text-muted-foreground">— {item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

Wire in `page.tsx` — fetch in parallel (admin rows only for `owner`/`org_admin`; `requireOrgRole` already returned `orgId` and `role`, adjust the destructure to `({ orgId, role, timeZone } = ...)`):

```tsx
import {
  listAccessReviews, listAuditLog, listInvitations, listMembers, listSupportSessions,
} from "@/features/identity-access/server/queries";
import { buildAdminSummary, type AdminSummary } from "@/features/dashboard/analytics/admin-summary-model";
import { getDashboardToday } from "@/features/dashboard/server/analytics-actions";

// after the guard:
const isAdmin = role === "owner" || role === "org_admin";
const [sales, today, adminSummary] = await Promise.all([
  getDashboardSales(organizationSlug, initialRange.from, initialRange.to,
    bucketForRange(initialRange.from, initialRange.to)),
  getDashboardToday(organizationSlug),
  isAdmin
    ? Promise.all([
        listMembers(orgId), listInvitations(orgId), listAccessReviews(orgId),
        listSupportSessions(orgId), listAuditLog({ organizationId: orgId, limit: 5 }),
      ]).then(([members, invitations, accessReviews, supportSessions, audit]): AdminSummary =>
        buildAdminSummary({ members, invitations, accessReviews, supportSessions, auditLog: audit.rows }))
      .catch(() => null)
    : Promise.resolve(null),
]);
```

Pass `today={today.ok ? today.data : null}` and `adminSummary={adminSummary}` to `AnalyticsDashboard`; render there after the chart row:

```tsx
{today ? <TodayStrip payload={today} /> : <SectionError />}
{adminSummary && <AdminPanel summary={adminSummary} organizationSlug={organizationSlug} />}
```

- [ ] **Step 6: Verify**

Run: `npm run test && npm run typecheck && npm run lint`; grep check: `features/overview` must have NO matches anywhere in `src/` or `e2e/`. Dev-server check the page renders both sections.
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dashboard): today's ops strip and admin panel; retire mock overview feature"
```

---

### Task 7: `get_dashboard_insights` RPC + pgTAP

**Files:**
- Create: `supabase/migrations/20260824000003_dashboard_insights_rpc.sql`
- Modify: `supabase/tests/rls/24_dashboard_rpcs.sql` (bump plan to 10, append)

**Interfaces:**
- Produces: `public.get_dashboard_insights(p_organization_id uuid, p_from date, p_to date) returns jsonb` with keys:
  - `pricing [{name, kg, revenue, realizedPerKg}]` (per product, delivered/closed in range)
  - `weight {warehouseKg, finalKg, diffKg, byProduct [{name, warehouseKg, finalKg, diffKg}]}`
  - `retention {active, newCustomers, returning, silent [{name, lastOrderDate, lifetimeRevenue}]}`
  - `delivery {attempts, failed, byZone [{zone, total, failed}], slotOrders, slotCapacity}`

- [ ] **Step 1: Append failing pgTAP tests**

Bump to `select plan(10);`. Add to the fixture block warehouse weight on the delivered item and a failed attempt:

```sql
update public.order_items set warehouse_weight_kg = 5.400
where id = 'd1000000-0000-0000-0000-000000000020';

insert into public.delivery_attempts (id, organization_id, run_id, order_id, outcome, reason,
                                      next_action, recorded_by)
values ('d1000000-0000-0000-0000-000000000050', 'd1000000-0000-0000-0000-00000000000a',
        'd1000000-0000-0000-0000-000000000030', 'd1000000-0000-0000-0000-000000000010',
        'failed', 'shop_closed', 'retry_today', 'd1000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
```

(Check the enum literal values in `20260821000003_driver_write_path.sql` — use real values for `outcome`/`reason`/`next_action`; `'failed'`, `'shop_closed'`, `'retry_today'` are the expected names, adjust if the enum differs.)

Append tests:

```sql
select ok(
  (select public.get_dashboard_insights('d1000000-0000-0000-0000-00000000000a',
     (now() at time zone 'Asia/Kuala_Lumpur')::date - 6, (now() at time zone 'Asia/Kuala_Lumpur')::date))
    ?& array['pricing','weight','retention','delivery'],
  'insights payload has all keys');

select is(
  (select public.get_dashboard_insights('d1000000-0000-0000-0000-00000000000a',
     (now() at time zone 'Asia/Kuala_Lumpur')::date - 6, (now() at time zone 'Asia/Kuala_Lumpur')::date) -> 'weight' ->> 'diffKg')::numeric,
  0.400::numeric,
  'weight leakage is warehouse minus final');
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run db:reset && npm run db:test`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Migration**

`supabase/migrations/20260824000003_dashboard_insights_rpc.sql`:

```sql
-- 20260824000003_dashboard_insights_rpc.sql
-- Owner/admin dashboard: improvement insights (pricing, weight leakage,
-- retention, delivery quality) over a date range.

begin;

create or replace function public.get_dashboard_insights(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_today date;
  v_pricing jsonb;
  v_weight jsonb;
  v_retention jsonb;
  v_delivery jsonb;
begin
  if not public.has_org_role(p_organization_id, array['owner','org_admin','seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_to < p_from or (p_to - p_from) + 1 > 400 then
    raise exception using errcode = 'P0001', message = 'invalid range';
  end if;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;
  v_today := (now() at time zone v_tz)::date;

  -- Realized RM/kg per product (delivered/closed, non-cancelled items).
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', t.name, 'kg', t.kg, 'revenue', t.revenue,
           'realizedPerKg', case when t.kg > 0 then round(t.revenue / t.kg, 2) else null end
         ) order by t.revenue desc), '[]'::jsonb)
  into v_pricing
  from (
    select p.name,
           sum(coalesce(oi.final_weight_kg, 0)) as kg,
           sum(coalesce(oi.line_total, 0)) as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
    group by p.name
    order by revenue desc
    limit 10
  ) t;

  -- Weight leakage: warehouse allocation vs final weighed, where both exist.
  select jsonb_build_object(
    'warehouseKg', coalesce(sum(w.warehouse_kg), 0),
    'finalKg', coalesce(sum(w.final_kg), 0),
    'diffKg', coalesce(sum(w.warehouse_kg - w.final_kg), 0),
    'byProduct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', w2.name, 'warehouseKg', w2.warehouse_kg, 'finalKg', w2.final_kg,
        'diffKg', w2.warehouse_kg - w2.final_kg) order by (w2.warehouse_kg - w2.final_kg) desc)
      from (
        select p.name,
               sum(oi.warehouse_weight_kg) as warehouse_kg,
               sum(oi.final_weight_kg) as final_kg
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
          and o.delivery_date between p_from and p_to
          and not oi.is_cancelled
          and oi.warehouse_weight_kg is not null
          and oi.final_weight_kg is not null
        group by p.name
        order by sum(oi.warehouse_weight_kg - oi.final_weight_kg) desc
        limit 5
      ) w2), '[]'::jsonb))
  into v_weight
  from (
    select sum(oi.warehouse_weight_kg) as warehouse_kg,
           sum(oi.final_weight_kg) as final_kg
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
      and oi.warehouse_weight_kg is not null
      and oi.final_weight_kg is not null
  ) w;

  -- Retention: customers active in range, split new vs returning; silent =
  -- customers whose last delivered/closed order is 30+ days before today.
  select jsonb_build_object(
    'active', (
      select count(distinct o.customer_id) from public.orders o
      where o.organization_id = p_organization_id
        and o.status in ('delivered','closed')
        and o.delivery_date between p_from and p_to),
    'newCustomers', (
      select count(*) from (
        select o.customer_id, min(o.delivery_date) as first_date
        from public.orders o
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
        group by o.customer_id
      ) fc where fc.first_date between p_from and p_to),
    'returning', (
      select count(distinct o.customer_id) from public.orders o
      where o.organization_id = p_organization_id
        and o.status in ('delivered','closed')
        and o.delivery_date between p_from and p_to
        and exists (
          select 1 from public.orders prior
          where prior.organization_id = p_organization_id
            and prior.customer_id = o.customer_id
            and prior.status in ('delivered','closed')
            and prior.delivery_date < p_from)),
    'silent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'lastOrderDate', s.last_date, 'lifetimeRevenue', s.revenue)
        order by s.revenue desc)
      from (
        select c.name, max(o.delivery_date) as last_date, sum(o.total_amount) as revenue
        from public.orders o
        join public.customers c on c.id = o.customer_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
        group by c.id, c.name
        having max(o.delivery_date) < v_today - 30
        order by sum(o.total_amount) desc
        limit 10
      ) s), '[]'::jsonb))
  into v_retention;

  -- Delivery quality: attempts in range by org-timezone day, plus slot fill.
  select jsonb_build_object(
    'attempts', count(*),
    'failed', count(*) filter (where da.outcome = 'failed'),
    'byZone', coalesce((
      select jsonb_agg(jsonb_build_object('zone', z.name, 'total', z.total, 'failed', z.failed)
               order by z.failed desc)
      from (
        select dz.name, count(*) as total,
               count(*) filter (where da2.outcome = 'failed') as failed
        from public.delivery_attempts da2
        join public.orders o2 on o2.id = da2.order_id
        join public.delivery_zones dz on dz.id = o2.zone_id
        where da2.organization_id = p_organization_id
          and ((da2.attempted_at at time zone v_tz)::date) between p_from and p_to
        group by dz.name
      ) z), '[]'::jsonb),
    'slotOrders', (
      select count(*) from public.orders o
      where o.organization_id = p_organization_id
        and o.status <> 'cancelled'
        and o.delivery_date between p_from and p_to),
    'slotCapacity', coalesce((
      select sum(ds.max_orders)
      from public.delivery_slots ds
      join generate_series(p_from, p_to, interval '1 day') d
        on extract(dow from d)::smallint = ds.weekday
      where ds.organization_id = p_organization_id
        and ds.is_active
        and ds.max_orders is not null), 0))
  into v_delivery
  from public.delivery_attempts da
  where da.organization_id = p_organization_id
    and ((da.attempted_at at time zone v_tz)::date) between p_from and p_to;

  return jsonb_build_object(
    'pricing', v_pricing,
    'weight', v_weight,
    'retention', v_retention,
    'delivery', v_delivery
  );
end;
$$;

revoke all on function public.get_dashboard_insights(uuid, date, date) from public;
grant execute on function public.get_dashboard_insights(uuid, date, date) to authenticated;

commit;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run db:reset && npm run db:test` — all PASS (file 24: 10 tests). Then `npm run db:types`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): get_dashboard_insights RPC with pgTAP coverage"
```

---

### Task 8: Insights model + improvement row UI

**Files:**
- Create: `src/features/dashboard/analytics/insights-model.ts`
- Create: `src/features/dashboard/analytics/components/insights-row.tsx`
- Test: `src/features/dashboard/tests/unit/insights-model.test.ts`
- Modify: `analytics-actions.ts` (add `getDashboardInsights`), `page.tsx`, `analytics-dashboard.tsx`, `en.json`, `ms.json`

**Interfaces:**
- Consumes: `get_dashboard_insights` RPC (Task 7); `getMarketSuggestions(orgId)` + `MarketSuggestion` from `@/features/market/server/actions` / `@/features/market/types`.
- Produces: `InsightsPayload` (mirrors the RPC jsonb), `buildInsightsViewModel(payload: InsightsPayload, suggestions: MarketSuggestion[]): InsightsViewModel` where pricing rows gain `marketBase: number | null` and `gapPct: number | null` matched by `product_name`; `delivery` gains `failureRate` and `slotFillPct`. `AnalyticsDashboard` props gain `initialInsights: InsightsPayload | null; marketSuggestions: MarketSuggestion[]`; range changes refetch insights together with sales.

- [ ] **Step 1: Failing test**

`src/features/dashboard/tests/unit/insights-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildInsightsViewModel, type InsightsPayload } from "../../analytics/insights-model";
import type { MarketSuggestion } from "@/features/market/types";

const payload: InsightsPayload = {
  pricing: [{ name: "Whole Chicken", kg: 100, revenue: 1000, realizedPerKg: 10 }],
  weight: { warehouseKg: 105, finalKg: 100, diffKg: 5, byProduct: [] },
  retention: { active: 10, newCustomers: 4, returning: 6, silent: [] },
  delivery: { attempts: 20, failed: 2, byZone: [], slotOrders: 30, slotCapacity: 60 },
};

const suggestions = [
  { product_name: "Whole Chicken", market_base: 9.5 } as unknown as MarketSuggestion,
];

describe("buildInsightsViewModel", () => {
  const vm = buildInsightsViewModel(payload, suggestions);

  it("pairs realized price with the market base and computes the gap", () => {
    expect(vm.pricing[0].marketBase).toBe(9.5);
    expect(vm.pricing[0].gapPct).toBeCloseTo(((10 - 9.5) / 9.5) * 100);
  });

  it("leaves the gap null without a matching suggestion", () => {
    const none = buildInsightsViewModel(payload, []);
    expect(none.pricing[0].marketBase).toBeNull();
    expect(none.pricing[0].gapPct).toBeNull();
  });

  it("computes failure rate and slot fill", () => {
    expect(vm.delivery.failureRate).toBeCloseTo(0.1);
    expect(vm.delivery.slotFillPct).toBeCloseTo(50);
  });

  it("computes weight leakage percentage", () => {
    expect(vm.weight.leakagePct).toBeCloseTo((5 / 105) * 100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/features/dashboard` — FAIL, module not found.

- [ ] **Step 3: Implement**

`src/features/dashboard/analytics/insights-model.ts`:

```ts
import type { MarketSuggestion } from "@/features/market/types";

export type PricingRow = { name: string; kg: number; revenue: number; realizedPerKg: number | null };
export type WeightByProduct = { name: string; warehouseKg: number; finalKg: number; diffKg: number };
export type SilentCustomer = { name: string; lastOrderDate: string; lifetimeRevenue: number };
export type ZoneQuality = { zone: string; total: number; failed: number };

export type InsightsPayload = {
  pricing: PricingRow[];
  weight: { warehouseKg: number; finalKg: number; diffKg: number; byProduct: WeightByProduct[] };
  retention: { active: number; newCustomers: number; returning: number; silent: SilentCustomer[] };
  delivery: { attempts: number; failed: number; byZone: ZoneQuality[]; slotOrders: number; slotCapacity: number };
};

export type InsightsViewModel = {
  pricing: Array<PricingRow & { marketBase: number | null; gapPct: number | null }>;
  weight: InsightsPayload["weight"] & { leakagePct: number };
  retention: InsightsPayload["retention"];
  delivery: InsightsPayload["delivery"] & { failureRate: number; slotFillPct: number | null };
};

export function buildInsightsViewModel(
  payload: InsightsPayload,
  suggestions: MarketSuggestion[],
): InsightsViewModel {
  const marketByProduct = new Map(
    suggestions
      .filter((s) => s.market_base != null)
      .map((s) => [s.product_name, Number(s.market_base)]),
  );
  return {
    pricing: payload.pricing.map((row) => {
      const marketBase = marketByProduct.get(row.name) ?? null;
      const gapPct =
        marketBase !== null && marketBase > 0 && row.realizedPerKg !== null
          ? ((row.realizedPerKg - marketBase) / marketBase) * 100
          : null;
      return { ...row, marketBase, gapPct };
    }),
    weight: {
      ...payload.weight,
      leakagePct:
        payload.weight.warehouseKg > 0
          ? (payload.weight.diffKg / payload.weight.warehouseKg) * 100
          : 0,
    },
    retention: payload.retention,
    delivery: {
      ...payload.delivery,
      failureRate:
        payload.delivery.attempts > 0 ? payload.delivery.failed / payload.delivery.attempts : 0,
      slotFillPct:
        payload.delivery.slotCapacity > 0
          ? (payload.delivery.slotOrders / payload.delivery.slotCapacity) * 100
          : null,
    },
  };
}
```

Run tests — PASS.

- [ ] **Step 4: Action, i18n, UI, wiring**

`analytics-actions.ts` (widen union again):

```ts
import type { InsightsPayload } from "../analytics/insights-model";

export async function getDashboardInsights(
  organizationSlug: string,
  from: string,
  to: string,
): Promise<ActionResult<InsightsPayload>> {
  return callDashboardRpc<InsightsPayload>(organizationSlug, "get_dashboard_insights", {
    p_from: from,
    p_to: to,
  });
}
```

`en.json` under `analytics`:

```json
"insights": {
  "title": "How to improve",
  "pricing": {
    "title": "Price vs market",
    "product": "Product",
    "realized": "Realized RM/kg",
    "market": "Market RM/kg",
    "gap": "Gap",
    "noMarket": "No market mapping"
  },
  "weight": {
    "title": "Weight leakage",
    "summary": "{diff} kg given away ({pct} of allocated weight)",
    "none": "No leakage recorded in this period."
  },
  "retention": {
    "title": "Customer retention",
    "active": "Active customers",
    "new": "New",
    "returning": "Returning",
    "silentTitle": "Silent 30+ days (win-back)",
    "noneSilent": "No silent customers. Nice."
  },
  "delivery": {
    "title": "Delivery quality",
    "failureRate": "Failed stop rate",
    "attempts": "{count} attempts",
    "slotFill": "Slot fill",
    "byZone": "Failures by zone"
  }
}
```

`ms.json`:

```json
"insights": {
  "title": "Cara nak improve",
  "pricing": {
    "title": "Harga vs pasaran",
    "product": "Produk",
    "realized": "RM/kg sebenar",
    "market": "RM/kg pasaran",
    "gap": "Beza",
    "noMarket": "Tiada pemetaan pasaran"
  },
  "weight": {
    "title": "Susut berat",
    "summary": "{diff} kg terlebih bagi ({pct} daripada berat diperuntuk)",
    "none": "Tiada susut berat dalam tempoh ini."
  },
  "retention": {
    "title": "Pengekalan pelanggan",
    "active": "Pelanggan aktif",
    "new": "Baharu",
    "returning": "Kembali",
    "silentTitle": "Senyap 30+ hari (win-back)",
    "noneSilent": "Tiada pelanggan senyap. Bagus."
  },
  "delivery": {
    "title": "Kualiti penghantaran",
    "failureRate": "Kadar stop gagal",
    "attempts": "{count} percubaan",
    "slotFill": "Kepenuhan slot",
    "byZone": "Kegagalan ikut zon"
  }
}
```

`insights-row.tsx` — four cards in a responsive grid. Pricing card: `table` component with product / realized / market / gap rows (gap green when negative-or-zero vs market? No — realized BELOW market is the miss: color gap red when `gapPct < 0`, green when `>= 0`; show `noMarket` muted text when null). Weight card: `summary` line + top `byProduct` list. Retention card: three stat numbers + silent list (name, last order date, lifetime revenue). Delivery card: failure rate %, attempts, slot fill %, byZone list. Use the same Card/CardHeader/CardContent + `useFormatter` patterns as `kpi-row.tsx`; full JSX is mechanical repetition of those patterns — keep every label from the keys above, no hardcoded copy.

Wire: `page.tsx` adds `getDashboardInsights(...)` + `getMarketSuggestions(orgId)` to the parallel fetch (suggestions in a `.catch(() => [])`); `analytics-dashboard.tsx` gains `initialInsights`/`marketSuggestions` props, `insights` state refetched inside the same `startTransition` as sales, and renders `<InsightsRow …/>` between the chart row and the today strip, `SectionError` when null.

- [ ] **Step 5: Verify**

`npm run test && npm run typecheck && npm run lint`; dev-server check (seed demo data has delivered orders with weights — insights populate).
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(dashboard): improvement insights row (pricing, weight, retention, delivery)"
```

---

### Task 9: Top lists tabs + custom date range

**Files:**
- Create: `src/features/dashboard/analytics/components/top-lists.tsx`
- Modify: `range-picker.tsx` (custom range), `analytics-dashboard.tsx`, `en.json`, `ms.json`

**Interfaces:**
- Consumes: `SalesViewModel.topProducts/.topCustomers/.topZones`; `Tabs` from `@/components/ui/tabs`, `Table` from `@/components/ui/table`.

- [ ] **Step 1: Top lists**

`top-lists.tsx`: one Card containing `Tabs` with three `TabsContent` panes (products / customers / zones). Each pane is a `Table` — products: name, kg, revenue; customers/zones: name, orders, revenue. Empty list renders `analytics.empty`. Keys:

`en.json`: `"topLists": { "title": "Top performers", "products": "Products", "customers": "Customers", "zones": "Zones", "name": "Name", "revenue": "Revenue", "orders": "Orders", "kg": "Kg" }`
`ms.json`: `"topLists": { "title": "Prestasi terbaik", "products": "Produk", "customers": "Pelanggan", "zones": "Zon", "name": "Nama", "revenue": "Jualan", "orders": "Pesanan", "kg": "Kg" }`

Mount in `analytics-dashboard.tsx` after the insights row.

- [ ] **Step 2: Custom range**

Extend `range-picker.tsx`: add a `custom` outline button; when active, show two native `<input type="date">` (from/to, styled with the `input` component) plus an apply Button. Props change to:

```ts
{
  active: RangePreset | "custom";
  range: { from: string; to: string };
  onSelect: (preset: RangePreset) => void;
  onCustom: (range: { from: string; to: string }) => void;
  disabled?: boolean;
}
```

Guard: apply disabled when `from > to` or either empty; clamp length client-side to 400 days (mirror the RPC guard). In `analytics-dashboard.tsx`, `onCustom` sets `preset = "custom"` and calls `applyRange(next)`.

- [ ] **Step 3: Verify**

`npm run test && npm run typecheck && npm run lint`; dev-server: switch tabs, apply a custom range, confirm chart re-buckets to weeks for ranges ≥ 60 days.
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(dashboard): top lists tabs and custom date range"
```

---

### Task 10: Landing redirect + e2e smoke

**Files:**
- Modify: `src/features/identity-access/server/landing.ts:25-32`
- Create: `e2e/dashboard-analytics.spec.ts`

**Interfaces:**
- Consumes: `MANAGER_ROLES`; existing e2e fixtures (`e2e/_fixtures.ts`) and the structure of `e2e/dashboard-shell.spec.ts`.

- [ ] **Step 1: Landing redirect**

In `landing.ts`, import `MANAGER_ROLES` alongside `STAFF_ROLES` and change `pathForRole`:

```ts
function pathForRole(role: string, slug: string): string {
  if ((MANAGER_ROLES as readonly string[]).includes(role)) {
    return `/${slug}/dashboard`;
  }
  if ((STAFF_ROLES as readonly string[]).includes(role)) {
    return `/${slug}/products`;
  }
  if (role === "driver") {
    return `/drive/${slug}`;
  }
  return `/${slug}/settings/organization`;
}
```

Update the file's header comment ("The landing page is Products" → managers land on the dashboard, warehouse staff keep Products). Grep for tests asserting the old landing path: `rtk grep -rn "products" src/features/identity-access e2e | grep -i land` — update any hit to expect `/dashboard` for manager roles.

- [ ] **Step 2: Guard — no overview references**

Grep `features/overview` across `src/` and `e2e/`.
Expected: no matches (the whole feature was moved/deleted in Task 6).

- [ ] **Step 3: e2e smoke**

Read `e2e/dashboard-shell.spec.ts` and `e2e/_fixtures.ts` first; mirror their login/org setup. `e2e/dashboard-analytics.spec.ts` asserts, as an owner visiting `/{org}/dashboard`:
- heading "Dashboard" visible (`getByRole("heading", { name: "Dashboard" })`)
- KPI card labels "Sales", "Orders", "Kg sold" visible
- range buttons "Today", "7 days", "30 days", "90 days" visible
- sidebar nav shows "Dashboard" as the first Sales item

(These strings come from `analytics.*`/`dashboard.pages.dashboard` in `en.json` — e2e locates by label text, keep them in sync.)

- [ ] **Step 4: Full verification**

Run: `npm run lint && npm run typecheck && npm run test && npm run db:test && npm run build`
Then `npm run test:e2e -- dashboard-analytics` (plus the full e2e suite if the local stack is up).
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dashboard): managers land on dashboard; e2e smoke"
```

---

## Post-plan notes

- Merge flow: this branch lives in the `owner-dashboard` worktree; finish with superpowers:finishing-a-development-branch (PR to `main`).
- Deploy debt: three new migrations + `grant execute` — prod is migrated through `20260823000012`, so these ship with the next prod migration push (see prod-deploy-debt memory).
- After merging to main, run `npm install` in the main checkout (recharts is a new dependency; worktree node_modules are separate).
