# Market Price Sync — Design Spec

**Date:** 2026-08-22
**Status:** Approved
**Feature:** Daily ingestion of KPDN PriceCatcher chicken prices, market-vs-own price suggestions in the seller dashboard, one-tap apply.

## Problem

Malaysian chicken prices float daily (KPDN stopped blanket price control Nov 2023). Sellers currently set `product_variants.price_per_unit` blind. KPDN publishes daily retail survey data (PriceCatcher, ~2M prices/month, CC BY 4.0) as monthly CSV/Parquet files on `storage.data.gov.my` — free, no API key, updated daily ~12:00 MYT with the previous day's prices.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Automation level | Suggest + approve. System never changes prices on its own. |
| Data slice | State-level aggregates (org-configurable state list, default `{Selangor}`). |
| Product linkage | Explicit per-variant mapping to a PriceCatcher item code. No name guessing. |
| Margin | Per-variant, RM/kg or percent, applied on top of market base. |
| Ingestion runtime | Supabase edge function + pg_cron + pg_net, same pattern as `access-review-reminder`. |

## Data source

- Prices: `https://storage.data.gov.my/pricecatcher/pricecatcher_YYYY-MM.csv` — columns `date, premise_code, item_code, price`. ~1.3M rows/month.
- Item lookup: `.../lookup_item.csv`. Tracked codes: **1** AYAM BERSIH - STANDARD (1kg), **2** AYAM BERSIH - SUPER (1kg), **3** AYAM HIDUP (1kg).
- Premise lookup: `.../lookup_premise.csv` — premise_code → premise, state, district.
- No REST API; daily file download is the intended pattern. Data lags real time by ~1 day. License CC BY 4.0 — attribute KPDN/data.gov.my in the UI footer of the card.

## Architecture

### 1. Edge function `market-price-sync`

Runs daily at 05:15 UTC (13:15 MYT) via pg_cron + pg_net (extends `20260624000005_id_access_schedules.sql` pattern).

Steps:
1. **Premise lookup refresh:** if `market_premises` is empty or last synced > 30 days ago, fetch `lookup_premise.csv` and upsert all rows.
2. **Fetch month file(s):** current month CSV; during the first 3 days of a month also fetch the previous month (late rows).
3. **Stream + filter:** parse CSV line-by-line (no full-file buffering). Keep rows where `item_code IN (1,2,3)` and the premise's state is in the union of all orgs' configured states (fallback `{Selangor}` when no `market_settings` rows exist). Everything else is discarded on the fly — memory stays flat regardless of file size.
4. **Aggregate:** group by `(date, item_code, state)` → median, avg, min, max, premise count.
5. **Upsert** into `market_prices` on conflict `(price_date, item_code, state)`. Idempotent; re-runs and backfills are safe.
6. On any fetch/parse failure: log, exit non-fatally. Existing rows untouched; UI shows last-good date.

### 2. Schema (one migration)

```sql
market_premises (
  premise_code int primary key,
  state text not null,
  district text,
  synced_at timestamptz not null default now()
)

market_prices (
  price_date date not null,
  item_code int not null,
  state text not null,
  median_price numeric(10,2) not null,
  avg_price numeric(10,2) not null,
  min_price numeric(10,2) not null,
  max_price numeric(10,2) not null,
  premise_count int not null,
  created_at timestamptz not null default now(),
  primary key (price_date, item_code, state)
)

market_settings (
  org_id uuid primary key references organizations(id),
  states text[] not null default '{Selangor}'
)

alter table product_variants add column market_item_code int;          -- null = not tracked
alter table product_variants add column market_margin_type text
  check (market_margin_type in ('rm','pct'));
alter table product_variants add column market_margin_value numeric(10,2);
```

RLS: `market_prices` and `market_premises` are public reference data — readable by any authenticated user, writable only by service role. `market_settings` follows the org-scoped pattern used by existing org tables.

### 3. Suggestion RPC `get_market_suggestions(org_id)`

For each variant in the org with `market_item_code` set:
- **base** = median of the last 7 available `median_price` rows for that item across the org's configured states (weighted by premise_count when merging states).
- **suggested** = `base + margin_value` (type `rm`) or `base * (1 + margin_value/100)` (type `pct`), rounded to 2 dp.
- Returns: variant id/name, current `price_per_unit`, base, suggested, latest `price_date`, `stale` flag (true when latest data > 3 days old).

### 4. UI (seller dashboard)

Card **"Harga Pasaran"**:
- Today's state median per tracked item (standard / super / live) + 30-day sparkline.
- Table of mapped variants: current price vs suggested, delta, per-row **Apply** button → server action sets `price_per_unit` to the suggested value (standard authz + existing audit behavior).
- `stale` → warning badge with last data date; Apply remains enabled.
- No mapped variants → market numbers only + hint linking to variant edit.
- Footer attribution: "Sumber: PriceCatcher, KPDN / data.gov.my (CC BY 4.0)".

Variant edit form: "Penanda aras pasaran" dropdown (Tiada / Ayam standard / Ayam super / Ayam hidup) + margin type toggle (RM / %) + margin value input. Margin fields required when a benchmark is chosen.

State config: simple select on the card (v1: single state from a fixed list of Malaysian states, stored as one-element array in `market_settings.states`; array type leaves room for multi-state later without a migration).

### 5. Error handling summary

| Failure | Behavior |
| --- | --- |
| data.gov.my unreachable | Job logs + exits; old data stands; card shows last-good date. |
| Data stale > 3 days | `stale: true`; UI warning; suggestions still shown. |
| Variant mapped but no market rows for state | Suggestion row shows "tiada data" for that variant. |
| Month rollover | Filename derived from current date; first-3-days dual fetch covers boundary. |

## Testing

- **Vitest:** CSV stream filter, median/aggregate math, month-file selection (incl. rollover + first-3-days dual fetch), suggestion calculation (rm and pct margins, rounding).
- **pgTAP:** `get_market_suggestions` output shape, RLS (seller reads own org's settings/suggestions only, market tables readable, non-service-role writes rejected).
- **E2E:** none in v1; Apply path covered by server-action unit tests.

## Out of scope (v1)

- Auto-apply pricing rules.
- District-level slicing, multi-state UI.
- Chicken parts benchmarks (dada, kepak, etc.) — schema supports any item_code already; UI dropdown limited to whole-bird codes for now.
- Buyer-facing market price display.
