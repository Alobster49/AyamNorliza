# Market Price Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily ingestion of KPDN PriceCatcher chicken prices into Supabase, with market-vs-own price suggestions and one-tap apply in the seller app.

**Architecture:** A Supabase edge function (`market-price-sync`) runs daily via pg_cron + pg_net (same pattern as `access-review-reminder`), downloads the monthly PriceCatcher CSV, filters to chicken item codes and configured states, and upserts per-day/per-state aggregates into `market_prices`. A SQL RPC `get_market_suggestions` computes suggested prices for variants mapped to a benchmark item. A new seller page `/{org}/market-prices` shows trends and suggestions with an Apply button.

**Tech Stack:** Next.js App Router + Supabase (Postgres, RLS, edge functions/Deno), pg_cron, pg_net, Vitest, pgTAP (`supabase test db`).

**Spec:** `docs/superpowers/specs/2026-08-22-market-price-sync-design.md`

## Global Constraints

- Tracked PriceCatcher item codes: `1` (AYAM BERSIH - STANDARD), `2` (AYAM BERSIH - SUPER), `3` (AYAM HIDUP). All priced per 1kg.
- Data URLs: `https://storage.data.gov.my/pricecatcher/pricecatcher_YYYY-MM.csv`, `.../lookup_premise.csv`. CSV fields may be quoted (addresses contain commas); `premise_code` appears as float strings like `"2.0"`; a junk row with `premise_code = -1` exists — skip rows that don't parse cleanly.
- Default state when no `market_settings` row: `Selangor`. State strings match PriceCatcher exactly, e.g. `W.P. Kuala Lumpur`, `Pulau Pinang`.
- Suggestion rule: base = median of `median_price` rows over the last 7 available days for the item + org states; suggested = `base + margin` (`rm`) or `base * (1 + margin/100)` (`pct`), rounded to 2 dp.
- Stale = latest `price_date` older than 3 days before `current_date`.
- System never changes prices automatically — Apply is always a user action.
- UI attribution (card footer): `Sumber: PriceCatcher, KPDN / data.gov.my (CC BY 4.0)`.
- Cron: daily `15 5 * * *` UTC (13:15 MYT). Schedules must no-op when `app.functions_url` is unset (existing pattern).
- Migrations: `20260823000001_market_price_sync.sql`, `20260823000002_market_price_schedule.sql` (sort after `20260822000001_data_console_rpcs.sql`).
- New app code lives in `src/features/market/`. UI copy in English like the rest of the seller app (except the Malay card title "Harga Pasaran" and attribution line).

---

### Task 1: Database migration — market tables, variant columns, RLS, suggestion RPC

**Files:**
- Create: `supabase/migrations/20260823000001_market_price_sync.sql`
- Create: `supabase/tests/rls/18_market_prices.sql`
- Modify: `src/types/database.generated.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces tables `market_premises`, `market_prices`, `market_settings`; columns `product_variants.market_item_code | market_margin_type | market_margin_value`; RPC `get_market_suggestions(p_organization_id uuid)` returning `(variant_id uuid, variant_name text, product_name text, current_price numeric, market_item_code int, market_base numeric, suggested_price numeric, latest_price_date date, stale boolean)`.
- Consumes: `organizations`, `organization_members`, `products`, `product_variants` (existing).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/18_market_prices.sql`:

```sql
-- supabase/tests/rls/18_market_prices.sql
-- market_prices / market_premises: readable by authenticated, not writable.
-- market_settings: org members only. get_market_suggestions: computes
-- suggested price from seeded market data.

begin;
select plan(8);

-- Seed: org, seller user, product + mapped variant, market rows.
insert into auth.users (id) values
  ('10000000-0000-0000-0000-000000000001') -- seller
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('20000000-0000-0000-0000-000000000002', 'MarketTest Org', 'markettest-org')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values ('20000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000001', 'seller', 'active')
on conflict do nothing;

insert into public.products (id, organization_id, name)
values ('30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000002', 'Ayam Bersih');

insert into public.product_variants
  (id, organization_id, product_id, name, price_per_unit,
   market_item_code, market_margin_type, market_margin_value)
values ('40000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000003',
        'Standard', 10.50, 1, 'rm', 1.00);

-- Seven days of Selangor medians 9.00..9.60 → median 9.30, +1.00 margin = 10.30.
insert into public.market_prices
  (price_date, item_code, state, median_price, avg_price, min_price, max_price, premise_count)
select current_date - offs, 1, 'Selangor',
       9.00 + offs * 0.10, 9.00 + offs * 0.10, 8.00, 11.00, 50
from generate_series(0, 6) as offs;

-- 1. anon cannot read market_prices.
set local role anon;
select throws_ok(
  $$ select count(*) from public.market_prices $$,
  '42501', null, 'anon cannot read market_prices');
reset role;

-- 2. authenticated can read market_prices.
set local role authenticated;
set local "request.jwt.claim.sub" to '10000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select count(*)::int from public.market_prices $$,
  array[7], 'authenticated reads market_prices');

-- 3. authenticated cannot write market_prices.
select throws_ok(
  $$ insert into public.market_prices
     (price_date, item_code, state, median_price, avg_price, min_price, max_price, premise_count)
     values (current_date, 1, 'Selangor', 1, 1, 1, 1, 1) $$,
  '42501', null, 'authenticated cannot insert market_prices');

-- 4. authenticated can read market_premises (empty is fine).
select lives_ok(
  $$ select count(*) from public.market_premises $$,
  'authenticated reads market_premises');

-- 5. org member can upsert own org market_settings.
select lives_ok(
  $$ insert into public.market_settings (org_id, states)
     values ('20000000-0000-0000-0000-000000000002', array['Selangor'])
     on conflict (org_id) do update set states = excluded.states $$,
  'member upserts own market_settings');

-- 6. member cannot insert settings for another org.
select throws_ok(
  $$ insert into public.market_settings (org_id, states)
     values ('99999999-0000-0000-0000-000000000009', array['Johor']) $$,
  null, null, 'cannot insert settings for foreign org');

-- 7. suggestion math: median 9.30 + RM1.00 margin = 10.30, not stale.
select results_eq(
  $$ select suggested_price::numeric(10,2), stale
     from public.get_market_suggestions('20000000-0000-0000-0000-000000000002') $$,
  $$ values (10.30::numeric(10,2), false) $$,
  'suggested price = 7-day median + rm margin');

-- 8. pct margin: 9.30 * 1.10 = 10.23.
reset role;
update public.product_variants
set market_margin_type = 'pct', market_margin_value = 10
where id = '40000000-0000-0000-0000-000000000004';
set local role authenticated;
set local "request.jwt.claim.sub" to '10000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select suggested_price::numeric(10,2)
     from public.get_market_suggestions('20000000-0000-0000-0000-000000000002') $$,
  $$ values (10.23::numeric(10,2)) $$,
  'pct margin applied');

select * from finish();
rollback;
```

Note on test 6: policy violations on insert normally raise `42501`; passing `null` as the errcode accepts any raised error, which also covers the FK failing first. Both mean "rejected", which is what we assert.

- [ ] **Step 2: Run test to verify it fails**

Run: `supabase test db`
Expected: `18_market_prices.sql` FAILS (relation `market_prices` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260823000001_market_price_sync.sql`:

```sql
-- 20260823000001_market_price_sync.sql
-- KPDN PriceCatcher market data: premise lookup cache, daily state-level
-- aggregates, per-org settings, benchmark mapping on product variants,
-- and the suggestion RPC.
-- Spec: docs/superpowers/specs/2026-08-22-market-price-sync-design.md

-- ---------------------------------------------------------------------------
-- market_premises: cache of PriceCatcher lookup_premise.csv
-- ---------------------------------------------------------------------------
create table if not exists public.market_premises (
  premise_code integer primary key,
  state text not null,
  district text null,
  synced_at timestamptz not null default now()
);

comment on table public.market_premises is
  'Cache of KPDN PriceCatcher premise lookup (premise_code -> state/district). Refreshed by the market-price-sync edge function.';

-- ---------------------------------------------------------------------------
-- market_prices: one row per (day, item, state)
-- ---------------------------------------------------------------------------
create table if not exists public.market_prices (
  price_date date not null,
  item_code integer not null,
  state text not null,
  median_price numeric(10,2) not null,
  avg_price numeric(10,2) not null,
  min_price numeric(10,2) not null,
  max_price numeric(10,2) not null,
  premise_count integer not null,
  created_at timestamptz not null default now(),
  primary key (price_date, item_code, state)
);

create index if not exists market_prices_item_state_date_idx
  on public.market_prices (item_code, state, price_date desc);

comment on table public.market_prices is
  'Daily state-level aggregates of KPDN PriceCatcher retail prices for tracked chicken items (1=standard, 2=super, 3=live).';

-- ---------------------------------------------------------------------------
-- market_settings: per-org state selection
-- ---------------------------------------------------------------------------
create table if not exists public.market_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  states text[] not null default '{Selangor}',
  updated_at timestamptz not null default now()
);

comment on table public.market_settings is
  'Which PriceCatcher states feed an organization''s market price card. v1 UI writes a single-element array.';

-- ---------------------------------------------------------------------------
-- product_variants: benchmark mapping
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add column if not exists market_item_code integer null,
  add column if not exists market_margin_type text null
    check (market_margin_type in ('rm', 'pct')),
  add column if not exists market_margin_value numeric(10,2) null;

comment on column public.product_variants.market_item_code is
  'PriceCatcher item code this variant benchmarks against (1/2/3); null = not tracked.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.market_premises enable row level security;
alter table public.market_prices enable row level security;
alter table public.market_settings enable row level security;

-- Reference data: any signed-in user may read; only service role writes
-- (service role bypasses RLS, so no write policies are defined).
create policy "market_premises_select" on public.market_premises
  for select to authenticated using (true);

create policy "market_prices_select" on public.market_prices
  for select to authenticated using (true);

-- Org-scoped settings, same shape as categories_* policies.
create policy "market_settings_select" on public.market_settings
  for select using (
    org_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "market_settings_insert" on public.market_settings
  for insert with check (
    org_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "market_settings_update" on public.market_settings
  for update using (
    org_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

grant select on public.market_premises, public.market_prices to authenticated;
grant select, insert, update on public.market_settings to authenticated;
grant all on public.market_premises, public.market_prices, public.market_settings
  to service_role;

-- ---------------------------------------------------------------------------
-- get_market_suggestions: suggested price per mapped variant.
-- SECURITY INVOKER: product_variants RLS restricts output to the caller's org.
-- ---------------------------------------------------------------------------
create or replace function public.get_market_suggestions(p_organization_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  product_name text,
  current_price numeric,
  market_item_code integer,
  market_base numeric,
  suggested_price numeric,
  latest_price_date date,
  stale boolean
)
language sql
stable
set search_path = public
as $$
  with org_states as (
    select coalesce(
      (select ms.states from public.market_settings ms
       where ms.org_id = p_organization_id),
      array['Selangor']
    ) as states
  ),
  mapped as (
    select pv.id, pv.name as variant_name, pr.name as product_name,
           pv.price_per_unit, pv.market_item_code,
           pv.market_margin_type, pv.market_margin_value
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    where pv.organization_id = p_organization_id
      and pv.market_item_code is not null
  ),
  latest as (
    -- newest available date per item within the org's states
    select m.id as vid, max(mp.price_date) as max_date
    from mapped m
    join public.market_prices mp
      on mp.item_code = m.market_item_code
     and mp.state = any((select states from org_states))
    group by m.id
  ),
  base as (
    -- median of median_price over the 7-day window ending at max_date
    select l.vid,
           percentile_cont(0.5) within group (order by mp.median_price)
             ::numeric(10,2) as market_base,
           l.max_date
    from latest l
    join mapped m on m.id = l.vid
    join public.market_prices mp
      on mp.item_code = m.market_item_code
     and mp.state = any((select states from org_states))
     and mp.price_date > l.max_date - 7
     and mp.price_date <= l.max_date
    group by l.vid, l.max_date
  )
  select m.id, m.variant_name, m.product_name, m.price_per_unit,
         m.market_item_code,
         b.market_base,
         case
           when b.market_base is null then null
           when m.market_margin_type = 'pct'
             then round(b.market_base * (1 + coalesce(m.market_margin_value, 0) / 100), 2)
           else round(b.market_base + coalesce(m.market_margin_value, 0), 2)
         end as suggested_price,
         b.max_date,
         coalesce(b.max_date < current_date - 3, true) as stale
  from mapped m
  left join base b on b.vid = m.id
  order by m.product_name, m.variant_name;
$$;

grant execute on function public.get_market_suggestions(uuid) to authenticated;
```

- [ ] **Step 4: Reset DB and run tests to verify they pass**

Run: `supabase db reset && supabase test db`
Expected: all files PASS, including `18_market_prices.sql` (8/8).

- [ ] **Step 5: Regenerate DB types**

Run: `npm run db:types`
Expected: `src/types/database.generated.ts` now contains `market_prices`, `market_premises`, `market_settings`, the three new `product_variants` columns, and `get_market_suggestions` under Functions.

Run: `npm run typecheck`
Expected: PASS (no code consumes the new tables yet).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260823000001_market_price_sync.sql supabase/tests/rls/18_market_prices.sql src/types/database.generated.ts
git commit -m "feat(db): market price tables, variant benchmark columns, suggestion RPC"
```

---

### Task 2: Edge function pure logic (CSV parsing + aggregation)

**Files:**
- Create: `supabase/functions/market-price-sync/logic.ts`
- Test: `src/features/market/tests/unit/market-sync-logic.test.ts`

**Interfaces:**
- Produces (all pure, no Deno APIs, imported by Task 3's `index.ts` and by the vitest file via relative path):
  - `monthKeys(today: Date): string[]` — `["YYYY-MM"]`, plus previous month when UTC day ≤ 3.
  - `splitCsvLine(line: string): string[]` — quote-aware split (addresses contain commas).
  - `parsePriceRow(line: string): PriceRow | null` — for `pricecatcher_*.csv` (`date,premise_code,item_code,price`); null for header/blank/malformed.
  - `parsePremiseRow(line: string): PremiseRow | null` — for `lookup_premise.csv` (`premise_code,premise,address,premise_type,state,district`); null when code < 0 or state blank. Handles float codes like `"2.0"`.
  - `aggregate(rows: Iterable<PriceRow>, premiseState: Map<number, string>, allowedStates: Set<string>, itemCodes: Set<number>): PriceAggregate[]`
  - `TRACKED_ITEM_CODES: Set<number>` = `{1, 2, 3}`.
  - Types: `PriceRow { date: string; premise_code: number; item_code: number; price: number }`, `PremiseRow { premise_code: number; state: string; district: string | null }`, `PriceAggregate { price_date: string; item_code: number; state: string; median_price: number; avg_price: number; min_price: number; max_price: number; premise_count: number }` (money fields rounded to 2 dp).

- [ ] **Step 1: Write the failing tests**

Create `src/features/market/tests/unit/market-sync-logic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  aggregate,
  monthKeys,
  parsePremiseRow,
  parsePriceRow,
  splitCsvLine,
  TRACKED_ITEM_CODES,
  type PriceRow,
} from "../../../../../supabase/functions/market-price-sync/logic";

describe("monthKeys", () => {
  it("returns current month only after the 3rd", () => {
    expect(monthKeys(new Date(Date.UTC(2026, 7, 22)))).toEqual(["2026-08"]);
  });

  it("includes previous month during the first 3 days", () => {
    expect(monthKeys(new Date(Date.UTC(2026, 8, 2)))).toEqual(["2026-09", "2026-08"]);
  });

  it("crosses year boundary", () => {
    expect(monthKeys(new Date(Date.UTC(2027, 0, 1)))).toEqual(["2027-01", "2026-12"]);
  });
});

describe("splitCsvLine", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quotes", () => {
    expect(splitCsvLine('2.0,PASAR,"JALAN A, TAMAN B",Pasar,Perak,Kinta')).toEqual([
      "2.0", "PASAR", "JALAN A, TAMAN B", "Pasar", "Perak", "Kinta",
    ]);
  });
});

describe("parsePriceRow", () => {
  it("parses a data line", () => {
    expect(parsePriceRow("2026-08-22,123,1,9.50")).toEqual({
      date: "2026-08-22", premise_code: 123, item_code: 1, price: 9.5,
    });
  });

  it("rejects header and malformed lines", () => {
    expect(parsePriceRow("date,premise_code,item_code,price")).toBeNull();
    expect(parsePriceRow("")).toBeNull();
    expect(parsePriceRow("2026-08-22,123,1")).toBeNull();
    expect(parsePriceRow("2026-08-22,123,1,notaprice")).toBeNull();
  });
});

describe("parsePremiseRow", () => {
  it("parses float premise codes and quoted addresses", () => {
    expect(
      parsePremiseRow('2.0,PASAR BESAR IPOH,"JALAN LAKSAMANA, 30300 IPOH",Pasar Basah ,Perak,Kinta'),
    ).toEqual({ premise_code: 2, state: "Perak", district: "Kinta" });
  });

  it("rejects junk rows", () => {
    expect(parsePremiseRow('-1.0,,",",,,')).toBeNull();
    expect(parsePremiseRow("premise_code,premise,address,premise_type,state,district")).toBeNull();
  });
});

describe("aggregate", () => {
  const premiseState = new Map<number, string>([
    [1, "Selangor"], [2, "Selangor"], [3, "Selangor"], [4, "Johor"],
  ]);

  const row = (premise: number, price: number, item = 1, date = "2026-08-22"): PriceRow =>
    ({ date, premise_code: premise, item_code: item, price });

  it("computes median/avg/min/max/count per (date,item,state)", () => {
    const out = aggregate(
      [row(1, 9.0), row(2, 10.0), row(3, 12.0)],
      premiseState, new Set(["Selangor"]), TRACKED_ITEM_CODES,
    );
    expect(out).toEqual([{
      price_date: "2026-08-22", item_code: 1, state: "Selangor",
      median_price: 10.0, avg_price: 10.33, min_price: 9.0, max_price: 12.0,
      premise_count: 3,
    }]);
  });

  it("uses mean of middle two for even counts", () => {
    const out = aggregate(
      [row(1, 9.0), row(2, 10.0), row(3, 12.0), row(3, 13.0)],
      premiseState, new Set(["Selangor"]), TRACKED_ITEM_CODES,
    );
    expect(out[0].median_price).toBe(11.0);
  });

  it("drops non-tracked items, unknown premises, and other states", () => {
    const out = aggregate(
      [row(1, 9.0), row(99, 9.0), row(4, 9.0), row(1, 5.0, 118)],
      premiseState, new Set(["Selangor"]), TRACKED_ITEM_CODES,
    );
    expect(out).toHaveLength(1);
    expect(out[0].premise_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/market/tests/unit/market-sync-logic.test.ts`
Expected: FAIL — cannot resolve `logic` module.

- [ ] **Step 3: Implement `logic.ts`**

Create `supabase/functions/market-price-sync/logic.ts`:

```ts
// Pure parsing/aggregation logic for the market-price-sync edge function.
// No Deno APIs here — this file is unit-tested with vitest from
// src/features/market/tests/unit/market-sync-logic.test.ts.

export type PriceRow = {
  date: string;
  premise_code: number;
  item_code: number;
  price: number;
};

export type PremiseRow = {
  premise_code: number;
  state: string;
  district: string | null;
};

export type PriceAggregate = {
  price_date: string;
  item_code: number;
  state: string;
  median_price: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  premise_count: number;
};

/** PriceCatcher items we track: 1=standard, 2=super, 3=live (all per 1kg). */
export const TRACKED_ITEM_CODES: Set<number> = new Set([1, 2, 3]);

/**
 * Month files to fetch. KPDN appends to the current month's file daily;
 * during the first 3 days we also refetch the previous month to pick up
 * late rows around the boundary.
 */
export function monthKeys(today: Date): string[] {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth(); // 0-based
  const key = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, "0")}`;
  const keys = [key(y, m)];
  if (today.getUTCDate() <= 3) {
    keys.push(m === 0 ? key(y - 1, 11) : key(y, m - 1));
  }
  return keys;
}

/** Minimal quote-aware CSV split (premise addresses contain commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Parse one pricecatcher_YYYY-MM.csv line: date,premise_code,item_code,price */
export function parsePriceRow(line: string): PriceRow | null {
  if (!line) return null;
  const parts = splitCsvLine(line.trim());
  if (parts.length < 4) return null;
  const [date, premiseRaw, itemRaw, priceRaw] = parts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null; // header or junk
  const premise_code = Math.trunc(Number.parseFloat(premiseRaw));
  const item_code = Math.trunc(Number.parseFloat(itemRaw));
  const price = Number.parseFloat(priceRaw);
  if (!Number.isFinite(premise_code) || !Number.isFinite(item_code) || !Number.isFinite(price)) {
    return null;
  }
  return { date, premise_code, item_code, price };
}

/** Parse one lookup_premise.csv line: premise_code,premise,address,premise_type,state,district */
export function parsePremiseRow(line: string): PremiseRow | null {
  if (!line) return null;
  const parts = splitCsvLine(line.trim());
  if (parts.length < 6) return null;
  const premise_code = Math.trunc(Number.parseFloat(parts[0]));
  const state = parts[4]?.trim();
  if (!Number.isFinite(premise_code) || premise_code < 0 || !state) return null;
  const district = parts[5]?.trim();
  return { premise_code, state, district: district || null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Group tracked-item rows from allowed states into per-(date,item,state) aggregates. */
export function aggregate(
  rows: Iterable<PriceRow>,
  premiseState: Map<number, string>,
  allowedStates: Set<string>,
  itemCodes: Set<number>,
): PriceAggregate[] {
  const groups = new Map<string, { state: string; item: number; date: string; prices: number[] }>();
  for (const r of rows) {
    if (!itemCodes.has(r.item_code)) continue;
    const state = premiseState.get(r.premise_code);
    if (!state || !allowedStates.has(state)) continue;
    const key = `${r.date}|${r.item_code}|${state}`;
    let g = groups.get(key);
    if (!g) {
      g = { state, item: r.item_code, date: r.date, prices: [] };
      groups.set(key, g);
    }
    g.prices.push(r.price);
  }

  const out: PriceAggregate[] = [];
  for (const g of groups.values()) {
    const sorted = [...g.prices].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, p) => acc + p, 0);
    out.push({
      price_date: g.date,
      item_code: g.item,
      state: g.state,
      median_price: round2(median(sorted)),
      avg_price: round2(sum / sorted.length),
      min_price: round2(sorted[0]),
      max_price: round2(sorted[sorted.length - 1]),
      premise_count: sorted.length,
    });
  }
  return out.sort((a, b) =>
    a.price_date.localeCompare(b.price_date) || a.item_code - b.item_code || a.state.localeCompare(b.state),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/market/tests/unit/market-sync-logic.test.ts`
Expected: PASS (all tests).

Note: vitest's include pattern `src/features/**/tests/unit/**/*.test.ts` already matches this test file; the relative import out of `src/` is fine.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/market-price-sync/logic.ts src/features/market/tests/unit/market-sync-logic.test.ts
git commit -m "feat(market): pure CSV parse + aggregate logic for price sync"
```

---

### Task 3: Edge function `market-price-sync` + cron schedule

**Files:**
- Create: `supabase/functions/market-price-sync/index.ts`
- Create: `supabase/migrations/20260823000002_market_price_schedule.sql`

**Interfaces:**
- Consumes: Task 2's `logic.ts` exports; tables from Task 1.
- Produces: deployed function invoked daily by pg_cron; responds `{ upserted: number, months: string[] }` on success, 500 + `{ error }` on failure.

- [ ] **Step 1: Write `index.ts`**

Create `supabase/functions/market-price-sync/index.ts`:

```ts
// supabase/functions/market-price-sync/index.ts
// Scheduled Edge Function: downloads the KPDN PriceCatcher monthly CSV,
// filters to tracked chicken items in the states any org has configured,
// and upserts per-(date,item,state) aggregates into market_prices.
//
// Schedule (pg_cron, 20260823000002): daily 05:15 UTC = 13:15 MYT,
// after KPDN's ~12:00 MYT daily upload.
// Data: https://data.gov.my/data-catalogue/pricecatcher (CC BY 4.0).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  aggregate,
  monthKeys,
  parsePremiseRow,
  parsePriceRow,
  TRACKED_ITEM_CODES,
  type PriceRow,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DATA_BASE = "https://storage.data.gov.my/pricecatcher";
const PREMISE_TTL_DAYS = 30;
const DEFAULT_STATES = ["Selangor"];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function* lines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) yield line;
  }
  if (buf) yield buf;
}

async function refreshPremisesIfStale(): Promise<void> {
  const { data, error } = await admin
    .from("market_premises")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`market_premises check: ${error.message}`);

  const newest = data?.[0]?.synced_at ? new Date(data[0].synced_at) : null;
  const staleBefore = Date.now() - PREMISE_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (newest && newest.getTime() > staleBefore) return;

  const res = await fetch(`${DATA_BASE}/lookup_premise.csv`);
  if (!res.ok) throw new Error(`lookup_premise.csv HTTP ${res.status}`);

  const rows: { premise_code: number; state: string; district: string | null }[] = [];
  for await (const line of lines(res)) {
    const parsed = parsePremiseRow(line);
    if (parsed) rows.push(parsed);
  }
  if (rows.length === 0) throw new Error("lookup_premise.csv parsed to 0 rows");

  for (let i = 0; i < rows.length; i += 500) {
    const { error: upsertError } = await admin
      .from("market_premises")
      .upsert(rows.slice(i, i + 500), { onConflict: "premise_code" });
    if (upsertError) throw new Error(`market_premises upsert: ${upsertError.message}`);
  }
}

async function configuredStates(): Promise<Set<string>> {
  const { data, error } = await admin.from("market_settings").select("states");
  if (error) throw new Error(`market_settings: ${error.message}`);
  const states = new Set<string>((data ?? []).flatMap((r) => r.states ?? []));
  for (const s of DEFAULT_STATES) states.add(s);
  return states;
}

async function premiseStateMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  // ~3k premises; page through to stay under PostgREST's row cap.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("market_premises")
      .select("premise_code, state")
      .range(from, from + 999);
    if (error) throw new Error(`market_premises read: ${error.message}`);
    for (const r of data ?? []) map.set(r.premise_code, r.state);
    if (!data || data.length < 1000) break;
  }
  return map;
}

Deno.serve(async () => {
  try {
    await refreshPremisesIfStale();
    const [states, premises] = await Promise.all([configuredStates(), premiseStateMap()]);

    const months = monthKeys(new Date());
    const rows: PriceRow[] = [];
    for (const month of months) {
      const res = await fetch(`${DATA_BASE}/pricecatcher_${month}.csv`);
      if (!res.ok) throw new Error(`pricecatcher_${month}.csv HTTP ${res.status}`);
      for await (const line of lines(res)) {
        const parsed = parsePriceRow(line);
        // Filter as we stream so memory stays proportional to tracked rows.
        if (parsed && TRACKED_ITEM_CODES.has(parsed.item_code)) rows.push(parsed);
      }
    }

    const aggregates = aggregate(rows, premises, states, TRACKED_ITEM_CODES);
    for (let i = 0; i < aggregates.length; i += 500) {
      const { error } = await admin
        .from("market_prices")
        .upsert(aggregates.slice(i, i + 500), { onConflict: "price_date,item_code,state" });
      if (error) throw new Error(`market_prices upsert: ${error.message}`);
    }

    return new Response(JSON.stringify({ upserted: aggregates.length, months }), { status: 200 });
  } catch (e) {
    console.error("market-price-sync failed", e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
```

- [ ] **Step 2: Write the schedule migration**

Create `supabase/migrations/20260823000002_market_price_schedule.sql`:

```sql
-- 20260823000002_market_price_schedule.sql
-- Daily pg_cron trigger for the market-price-sync Edge Function.
-- 05:15 UTC = 13:15 MYT, after KPDN's ~12:00 MYT PriceCatcher upload.
-- Same no-op-without-settings pattern as 20260624000005_id_access_schedules.sql.

select cron.schedule(
  'market-price-sync-daily',
  '15 5 * * *',
  $cron$
    do $$
    begin
      if coalesce(current_setting('app.functions_url', true), '') = '' then
        raise notice 'app.functions_url not set; market-price-sync cron is a no-op';
        return;
      end if;
      perform net.http_post(
        url := current_setting('app.functions_url') || '/market-price-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.functions_key', true), '')
        ),
        body := '{}'::jsonb
      );
    end $$;
  $cron$
);
```

- [ ] **Step 3: Verify locally**

Run: `supabase db reset` (applies both new migrations cleanly)
Expected: reset succeeds; `select jobname from cron.job;` (via `supabase db psql` or Studio) lists `market-price-sync-daily`.

Run the function once against local stack:

```bash
supabase functions serve market-price-sync --no-verify-jwt &
sleep 2 && curl -s -X POST http://127.0.0.1:54321/functions/v1/market-price-sync | head -c 300
```

Expected: JSON `{"upserted": N, "months": ["2026-08"]}` with N > 0 (downloads the real ~40MB CSV; takes a minute). Then verify rows:
`select count(*), max(price_date) from market_prices;` → count > 0, max = yesterday or today. Kill the serve process afterwards.

- [ ] **Step 4: Run full test suite (regression)**

Run: `npm run test && supabase test db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/market-price-sync/index.ts supabase/migrations/20260823000002_market_price_schedule.sql
git commit -m "feat(market): market-price-sync edge function + daily pg_cron schedule"
```

---

### Task 4: Market feature types, model helpers, and server actions

**Files:**
- Create: `src/features/market/types.ts`
- Create: `src/features/market/lib/market-model.ts`
- Create: `src/features/market/server/actions.ts`
- Test: `src/features/market/tests/unit/market-model.test.ts`

**Interfaces:**
- Consumes: `get_market_suggestions` RPC, `market_prices`, `market_settings` (Task 1); `Database` generated types.
- Produces (used by Task 5's UI):
  - `types.ts`: `MARKET_ITEMS: { code: number; label: string }[]` = `[{1,"Ayam standard"},{2,"Ayam super"},{3,"Ayam hidup"}]`; `MARKET_STATES: readonly string[]` (16 PriceCatcher state strings); `MarketMarginType = "rm" | "pct"`; `MarketSuggestion` (RPC row type); `MarketPriceRow` (`market_prices` Row type).
  - `market-model.ts`: `sparklinePoints(rows: { price_date: string; median_price: number }[], width: number, height: number): string` (SVG polyline points, oldest→newest, 2px vertical padding); `priceDelta(current: number, suggested: number): { amount: number; pct: number }`.
  - `actions.ts` (all `"use server"`):
    - `getMarketState(orgId: string): Promise<string>` — org's single state (first element), default `"Selangor"`.
    - `setMarketState(orgId: string, state: string, orgSlug?: string): Promise<void>` — upserts `market_settings` with `[state]`.
    - `getMarketTrend(states: string[], days?: number): Promise<MarketPriceRow[]>` — last `days` (default 30) of rows for item codes 1–3 in `states`, ascending by date.
    - `getMarketSuggestions(orgId: string): Promise<MarketSuggestion[]>` — calls the RPC.
    - `applySuggestedPrice(variantId: string, price: number, orgSlug?: string): Promise<void>` — sets `price_per_unit`; RLS enforces org/role.

- [ ] **Step 1: Write the failing model tests**

Create `src/features/market/tests/unit/market-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { priceDelta, sparklinePoints } from "../../lib/market-model";

describe("sparklinePoints", () => {
  it("maps oldest->newest across the width, high price = low y", () => {
    const rows = [
      { price_date: "2026-08-01", median_price: 9 },
      { price_date: "2026-08-02", median_price: 10 },
      { price_date: "2026-08-03", median_price: 11 },
    ];
    const points = sparklinePoints(rows, 100, 30);
    const pairs = points.split(" ").map((p) => p.split(",").map(Number));
    expect(pairs).toHaveLength(3);
    expect(pairs[0][0]).toBe(0);
    expect(pairs[2][0]).toBe(100);
    expect(pairs[0][1]).toBe(28); // min price -> bottom (height - pad)
    expect(pairs[2][1]).toBe(2);  // max price -> top (pad)
  });

  it("handles a flat series without dividing by zero", () => {
    const rows = [
      { price_date: "2026-08-01", median_price: 9 },
      { price_date: "2026-08-02", median_price: 9 },
    ];
    const pairs = sparklinePoints(rows, 100, 30).split(" ").map((p) => p.split(",").map(Number));
    expect(pairs[0][1]).toBe(15);
    expect(pairs[1][1]).toBe(15);
  });

  it("returns empty string for fewer than 2 rows", () => {
    expect(sparklinePoints([], 100, 30)).toBe("");
    expect(sparklinePoints([{ price_date: "2026-08-01", median_price: 9 }], 100, 30)).toBe("");
  });
});

describe("priceDelta", () => {
  it("computes signed amount and percent vs current", () => {
    expect(priceDelta(10, 10.5)).toEqual({ amount: 0.5, pct: 5 });
    expect(priceDelta(10, 9)).toEqual({ amount: -1, pct: -10 });
  });

  it("rounds to 2dp and handles zero current price", () => {
    expect(priceDelta(9.99, 10.11)).toEqual({ amount: 0.12, pct: 1.2 });
    expect(priceDelta(0, 5)).toEqual({ amount: 5, pct: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/market/tests/unit/market-model.test.ts`
Expected: FAIL — cannot resolve `../../lib/market-model`.

- [ ] **Step 3: Implement types + model**

Create `src/features/market/types.ts`:

```ts
import type { Database } from "@/types/database.generated";

export type MarketPriceRow = Database["public"]["Tables"]["market_prices"]["Row"];
export type MarketSuggestion =
  Database["public"]["Functions"]["get_market_suggestions"]["Returns"][number];

export type MarketMarginType = "rm" | "pct";

/** PriceCatcher benchmark items selectable on a variant (all per 1kg). */
export const MARKET_ITEMS = [
  { code: 1, label: "Ayam standard" },
  { code: 2, label: "Ayam super" },
  { code: 3, label: "Ayam hidup" },
] as const;

export function marketItemLabel(code: number | null): string {
  return MARKET_ITEMS.find((i) => i.code === code)?.label ?? "—";
}

/** State strings exactly as they appear in PriceCatcher's premise lookup. */
export const MARKET_STATES = [
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang",
  "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor",
  "Terengganu", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya",
] as const;
```

Create `src/features/market/lib/market-model.ts`:

```ts
/** Pure presentation helpers for the market prices page. */

const PAD = 2;

/**
 * SVG polyline points for a sparkline. Rows must be date-ascending;
 * returns "" when there is nothing to draw a line through.
 */
export function sparklinePoints(
  rows: { price_date: string; median_price: number }[],
  width: number,
  height: number,
): string {
  if (rows.length < 2) return "";
  const prices = rows.map((r) => r.median_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;
  const usable = height - PAD * 2;
  return rows
    .map((r, i) => {
      const x = (i / (rows.length - 1)) * width;
      const y = span === 0 ? height / 2 : PAD + (1 - (r.median_price - min) / span) * usable;
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");
}

export function priceDelta(current: number, suggested: number): { amount: number; pct: number } {
  const amount = round2(suggested - current);
  const pct = current === 0 ? 0 : round2((amount / current) * 100);
  return { amount, pct };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/market/tests/unit/market-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement server actions**

Create `src/features/market/server/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import type { MarketPriceRow, MarketSuggestion } from "../types";

const DEFAULT_STATE = "Selangor";
const TRACKED_ITEM_CODES = [1, 2, 3];

export async function getMarketState(orgId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("market_settings")
    .select("states")
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.states?.[0] ?? DEFAULT_STATE;
}

export async function setMarketState(orgId: string, state: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("market_settings")
    .upsert({ org_id: orgId, states: [state], updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  if (orgSlug) revalidatePath(`/${orgSlug}/market-prices`);
}

export async function getMarketTrend(
  states: string[],
  days = 30,
): Promise<MarketPriceRow[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data } = await supabase
    .from("market_prices")
    .select("*")
    .in("item_code", TRACKED_ITEM_CODES)
    .in("state", states)
    .gte("price_date", since)
    .order("price_date", { ascending: true });
  return data ?? [];
}

export async function getMarketSuggestions(orgId: string): Promise<MarketSuggestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_market_suggestions", {
    p_organization_id: orgId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Apply a suggested price to a variant. Always user-initiated — the sync
 * job never touches price_per_unit. RLS restricts the update to sellers
 * of the variant's org.
 */
export async function applySuggestedPrice(variantId: string, price: number, orgSlug?: string) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price");
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ price_per_unit: Math.round(price * 100) / 100 })
    .eq("id", variantId);
  if (error) throw new Error(error.message);
  if (orgSlug) {
    revalidatePath(`/${orgSlug}/market-prices`);
    revalidatePath(`/${orgSlug}/products`);
  }
}
```

- [ ] **Step 6: Typecheck and full unit suite**

Run: `npm run typecheck && npm run test`
Expected: PASS. (If `Database["public"]["Functions"]["get_market_suggestions"]` is missing, re-run `npm run db:types` with the local stack running — Task 1 Step 5 should already have added it.)

- [ ] **Step 7: Commit**

```bash
git add src/features/market
git commit -m "feat(market): types, sparkline/delta model, server actions"
```

---

### Task 5: Market Prices page + sidebar nav

**Files:**
- Create: `src/app/(seller)/[organizationSlug]/market-prices/page.tsx`
- Create: `src/app/(seller)/[organizationSlug]/market-prices/market-prices-client.tsx`
- Modify: `src/features/seller/lib/seller-shell-model.ts` (add nav item to the `Sales` group)

**Interfaces:**
- Consumes: Task 4 actions and types; `getOrganizationBySlug` from `@/features/identity-access/server/queries`; UI kit at `@/components/ui/*`; `formatPrice` from `@/features/seller/lib/pricing`.
- Produces: route `/{organizationSlug}/market-prices`; nav entry "Market Prices".

- [ ] **Step 1: Add the nav item**

In `src/features/seller/lib/seller-shell-model.ts`, extend the `Sales` group:

```ts
const routeGroups = [
  {
    title: "Sales",
    items: [
      { title: "Products", segment: "products" },
      { title: "Orders", segment: "orders" },
      { title: "Customers", segment: "customers" },
      { title: "Market Prices", segment: "market-prices" },
    ],
  },
] as const;
```

- [ ] **Step 2: Create the server page**

Create `src/app/(seller)/[organizationSlug]/market-prices/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import {
  getMarketState,
  getMarketSuggestions,
  getMarketTrend,
} from "@/features/market/server/actions";
import { MarketPricesClient } from "./market-prices-client";

export default async function MarketPricesPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const state = await getMarketState(org.id);
  const [trend, suggestions] = await Promise.all([
    getMarketTrend([state]),
    getMarketSuggestions(org.id),
  ]);

  return (
    <MarketPricesClient
      organizationId={org.id}
      organizationSlug={organizationSlug}
      state={state}
      trend={trend}
      suggestions={suggestions}
    />
  );
}
```

- [ ] **Step 3: Create the client component**

Create `src/app/(seller)/[organizationSlug]/market-prices/market-prices-client.tsx`:

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { applySuggestedPrice, setMarketState } from "@/features/market/server/actions";
import { priceDelta, sparklinePoints } from "@/features/market/lib/market-model";
import {
  MARKET_ITEMS,
  MARKET_STATES,
  marketItemLabel,
  type MarketPriceRow,
  type MarketSuggestion,
} from "@/features/market/types";
import { formatPrice } from "@/features/seller/lib/pricing";

const SPARK_W = 160;
const SPARK_H = 36;

type Props = {
  organizationId: string;
  organizationSlug: string;
  state: string;
  trend: MarketPriceRow[];
  suggestions: MarketSuggestion[];
};

export function MarketPricesClient({
  organizationId,
  organizationSlug,
  state,
  trend,
  suggestions,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const byItem = useMemo(() => {
    const map = new Map<number, MarketPriceRow[]>();
    for (const row of trend) {
      const rows = map.get(row.item_code) ?? [];
      rows.push(row);
      map.set(row.item_code, rows);
    }
    return map;
  }, [trend]);

  const anyStale = suggestions.some((s) => s.stale);
  const latestDate = trend.at(-1)?.price_date;

  const handleStateChange = (next: string) => {
    startTransition(async () => {
      try {
        await setMarketState(organizationId, next, organizationSlug);
        router.refresh();
      } catch (error) {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
    });
  };

  const handleApply = (s: MarketSuggestion) => {
    if (s.suggested_price == null) return;
    setApplyingId(s.variant_id);
    startTransition(async () => {
      try {
        await applySuggestedPrice(s.variant_id, s.suggested_price!, organizationSlug);
        toast({ title: `Price updated to ${formatPrice(s.suggested_price!)}` });
        router.refresh();
      } catch (error) {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      } finally {
        setApplyingId(null);
      }
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Harga Pasaran</h1>
          <p className="text-sm text-muted-foreground">
            KPDN retail survey medians{latestDate ? ` — latest data ${latestDate}` : ""}
          </p>
        </div>
        <div className="w-56">
          <Select value={state} onValueChange={handleStateChange} disabled={isPending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MARKET_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {anyStale && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Market data is more than 3 days old. Suggestions may not reflect today&apos;s market.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MARKET_ITEMS.map((item) => {
          const rows = byItem.get(item.code) ?? [];
          const latest = rows.at(-1);
          const points = sparklinePoints(rows, SPARK_W, SPARK_H);
          return (
            <Card key={item.code}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {item.label} · {state}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-2xl font-semibold">
                    {latest ? `${formatPrice(latest.median_price)}/kg` : "Tiada data"}
                  </div>
                  {latest && (
                    <div className="text-xs text-muted-foreground">
                      {latest.premise_count} premises · {latest.price_date}
                    </div>
                  )}
                </div>
                {points && (
                  <svg
                    width={SPARK_W}
                    height={SPARK_H}
                    viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                    className="text-primary"
                    aria-hidden
                  >
                    <polyline
                      points={points}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price suggestions</CardTitle>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No variants are tracking a market benchmark yet. Edit a size/option under
              Products and pick a benchmark to get suggestions here.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Variant</th>
                  <th className="py-2 font-medium">Benchmark</th>
                  <th className="py-2 font-medium">Market base</th>
                  <th className="py-2 font-medium">Current</th>
                  <th className="py-2 font-medium">Suggested</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const delta =
                    s.suggested_price != null
                      ? priceDelta(s.current_price, s.suggested_price)
                      : null;
                  const matches =
                    s.suggested_price != null && delta !== null && delta.amount === 0;
                  return (
                    <tr key={s.variant_id} className="border-t">
                      <td className="py-2">
                        {s.product_name} — {s.variant_name}
                      </td>
                      <td className="py-2">{marketItemLabel(s.market_item_code)}</td>
                      <td className="py-2">
                        {s.market_base != null ? formatPrice(s.market_base) : "Tiada data"}
                      </td>
                      <td className="py-2">{formatPrice(s.current_price)}</td>
                      <td className="py-2">
                        {s.suggested_price != null ? (
                          <span>
                            {formatPrice(s.suggested_price)}{" "}
                            {delta && delta.amount !== 0 && (
                              <span
                                className={
                                  delta.amount > 0 ? "text-emerald-600" : "text-red-600"
                                }
                              >
                                ({delta.amount > 0 ? "+" : ""}
                                {delta.pct}%)
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          disabled={
                            s.suggested_price == null || matches || applyingId === s.variant_id
                          }
                          onClick={() => handleApply(s)}
                        >
                          {matches ? "Up to date" : "Apply"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Sumber: PriceCatcher, KPDN / data.gov.my (CC BY 4.0)
      </p>
    </div>
  );
}
```

Layout/heading conventions: mirror sibling pages (`products`, `customers`) — if those pages don't wrap content in `p-6` (the shell already pads), drop the outer padding class to match.

- [ ] **Step 4: Verify in the browser**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

Start the dev server (launch config / `npm run dev`, port 9999) with the local Supabase stack running and market data populated (Task 3 Step 3). Sign in as the seed seller, open `/{org-slug}/market-prices`:
- Nav shows "Market Prices" under Sales.
- Cards show medians + sparkline for Selangor (items with no data show "Tiada data").
- Suggestions table empty-state text shows (no variant mapped yet).
- Switch state to `Johor` → page refreshes with Johor data.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(seller\)/\[organizationSlug\]/market-prices src/features/seller/lib/seller-shell-model.ts
git commit -m "feat(market): market prices page with trend cards and suggestions table"
```

---

### Task 6: Benchmark fields in the variant dialog

**Files:**
- Modify: `src/features/seller/components/products/variant-dialog.tsx`

**Interfaces:**
- Consumes: `MARKET_ITEMS`, `MarketMarginType` from `@/features/market/types`; existing `createVariant`/`updateVariant` actions (already pass through arbitrary `product_variants` columns; regenerated types from Task 1 make the new columns valid `ProductVariantInsert/Update` fields).
- Produces: sellers can set `market_item_code`, `market_margin_type`, `market_margin_value` per variant.

- [ ] **Step 1: Extend the dialog**

In `src/features/seller/components/products/variant-dialog.tsx`:

Add imports:

```tsx
import { MARKET_ITEMS, type MarketMarginType } from "@/features/market/types";
```

Add state after the existing `available` state (line ~48):

```tsx
const [benchmark, setBenchmark] = useState<string>(
  variant?.market_item_code != null ? String(variant.market_item_code) : "none",
);
const [marginType, setMarginType] = useState<MarketMarginType>(
  (variant?.market_margin_type as MarketMarginType) ?? "rm",
);
```

Extend the `input` object in `handleSubmit`:

```tsx
const tracked = benchmark !== "none";
const input = {
  name: data.get("name") as string,
  price_per_unit: Number(data.get("price_per_unit")),
  unit_type: unitType,
  is_available: available,
  market_item_code: tracked ? Number(benchmark) : null,
  market_margin_type: tracked ? marginType : null,
  market_margin_value: tracked ? Number(data.get("market_margin_value")) : null,
};
```

Add the fields to the form, between the price field and the availability checkbox:

```tsx
<div className="space-y-2">
  <Label>Market benchmark (KPDN)</Label>
  <Select value={benchmark} onValueChange={setBenchmark}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">Not tracked</SelectItem>
      {MARKET_ITEMS.map((item) => (
        <SelectItem key={item.code} value={String(item.code)}>
          {item.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
{benchmark !== "none" && (
  <div className="grid grid-cols-2 gap-2">
    <div className="space-y-2">
      <Label>Margin type</Label>
      <Select value={marginType} onValueChange={(v) => setMarginType(v as MarketMarginType)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="rm">RM per kg</SelectItem>
          <SelectItem value="pct">% of market</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="space-y-2">
      <Label htmlFor="variant-margin">
        {marginType === "pct" ? "Margin (%)" : "Margin (RM)"}
      </Label>
      <Input
        id="variant-margin"
        name="market_margin_value"
        type="number"
        step="0.01"
        defaultValue={variant?.market_margin_value ?? ""}
        required
      />
    </div>
  </div>
)}
```

Note: margin may be negative (selling below market), so no `min` attribute.

- [ ] **Step 2: Verify end-to-end in the browser**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

With dev server + local stack running:
1. Products → a product → edit a size/option → set benchmark "Ayam standard", margin type RM, value `1.00` → save. Reopen dialog → fields persist.
2. Market Prices page → the variant now appears in the suggestions table with market base, suggested = base + 1.00, and an Apply button.
3. Click Apply → toast, current price becomes the suggested price, button flips to "Up to date".
4. Set benchmark back to "Not tracked" → save → variant disappears from suggestions.

- [ ] **Step 3: Run full suites (regression)**

Run: `npm run test && npm run typecheck && npm run lint && supabase test db`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/seller/components/products/variant-dialog.tsx
git commit -m "feat(market): benchmark + margin fields on variant dialog"
```

---

### Task 7: Production deploy notes (no code)

Deployment steps for whoever releases (record in PR description):

1. `supabase db push` — applies both migrations (tables + cron).
2. `supabase functions deploy market-price-sync`.
3. Confirm DB settings `app.functions_url` / `app.functions_key` are already set in production (they drive the existing reminder crons; the new cron reuses them; without them it logs a notice and no-ops).
4. First run: invoke the function once manually (`supabase functions invoke market-price-sync` or curl with the service key) so the page has data before the first 13:15 MYT cron tick.
