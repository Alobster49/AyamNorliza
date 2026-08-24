# Owner/Admin Analytics Dashboard — Design

**Date:** 2026-08-24
**Status:** Approved (brainstorming session with Hafiz)
**Scope decision:** Full analytics module in one build (option B), sequenced so the sales core lands first and each stage is independently shippable.
**Branch:** `feat/owner-dashboard` (worktree off `origin/main`)

## Goal

A new dashboard page for owners and admins that answers, at a glance:

1. How are sales doing (revenue, volume, funnel)?
2. Where can we improve (pricing vs market, weight leakage, retention, delivery quality)?
3. What needs attention today (runs, tasks, alerts)?

## Context

- All data already exists, org-scoped and RLS-guarded: `orders` (status funnel, `total_amount`, delivery date, zone, customer), `order_items` (`final_weight_kg`, `price_per_kg`, computed `line_total`), `order_weight_log`, `delivery_runs` + stops, `order_tasks`, `customers` (buyer-synced), `products`, `market_prices` (KPDN sync + `get_market_suggestions` RPC), identity tables.
- `src/features/overview/` contains a mock "flock" operations overview (hardcoded farm metrics, wired to no route). Wrong domain; retired as part of this work.
- The sidebar has no Dashboard item today. No chart library is installed.

## Route and access

- New page at `src/app/[locale]/(seller)/[organizationSlug]/dashboard/` — server `page.tsx` plus a `dashboard-client.tsx`.
- Sidebar: a "Dashboard" item at the top of the Sales group in `src/features/dashboard/components/dashboard-shell-model.ts`. Hidden from `STAFF_ONLY_ROLES` (inventory, logistics) and from drivers.
- Landing behavior: the organization root redirects owners/admins to `/dashboard`. The existing staff redirect to `/tasks` is unchanged.
- Feature code lives in the existing `src/features/dashboard/` directory (`components/`, `server/`, `tests/`).

## Data layer

Three SQL RPCs following the data-console RPC pattern (org-membership check inside the function; explicit `grant execute` per calling role — new functions get no default grants):

1. `get_dashboard_sales(p_org, p_from, p_to, p_bucket)`
   - KPI totals for the range plus comparison against the previous equal-length period: revenue, order count, kg sold, average order value, realized RM/kg.
   - Revenue time series bucketed by day (or week for long ranges).
   - Status funnel counts and cancellation rate.
   - Top products, top customers, and sales by zone.
2. `get_dashboard_insights(p_org, p_from, p_to)`
   - Price vs market: realized RM/kg per product against KPDN market price (reuses `get_market_suggestions` logic).
   - Weight leakage: estimated vs final weight from `order_weight_log`.
   - Retention: new vs repeat customers, customers with no order in 30+ days (win-back list).
   - Delivery quality: failed-stop rate per zone/run, truck slot utilization.
3. `get_dashboard_today(p_org)`
   - Today's runs with stop progress, warehouse tasks pending/done. (The weigh queue IS the pending-task count: every `order_tasks` row is an allocate-and-weigh task, so a separate weigh-station metric would duplicate it — collapsed by decision 2026-08-24.)
   - Alerts: orders without an assigned run, stale market price sync.

### Definitions (fixed, not configurable)

- **Revenue** = `orders.total_amount` of orders in status `delivered` or `closed`, bucketed by `delivery_date`. Cancelled orders are excluded from revenue and surfaced as a cancellation rate.
- **Funnel counts** use `created_at`.
- **Day boundary** = Asia/Kuala_Lumpur, computed in SQL, never in the client.

## UI layout (top to bottom)

1. **Date-range bar** — presets Today / 7d / 30d / 90d / custom range; comparison badge vs the previous period.
2. **KPI row** — revenue, orders, kg sold, AOV, realized RM/kg, each with a delta arrow.
3. **Revenue chart** (30d default) beside the **status funnel**.
4. **Improvement row** — price-vs-market table, weight-leakage card, retention card, delivery-quality card.
5. **Top lists** — tabs for products / customers / zones.
6. **Ops-today strip** — runs, tasks (pending count doubles as the weigh queue — see Data layer note), alerts. Always shows today; ignores the date filter.
7. **Admin panel** — pending invitations, open access reviews, recent audit events via the existing `buildOverviewDashboardSummary`.

Charts use `recharts` with the shadcn chart wrapper (new dependency). All copy is key-based i18n in `en.json` and `ms.json` from day one — no hardcoded prose (e2e specs locate fields by label text, so specs are added/updated alongside copy).

## Loading and errors

Each section fetches independently (parallel server calls streamed via Suspense). A section failure renders a section-level error card; one broken RPC never blanks the page. An org with no data gets zero-state cards, not empty charts.

## Testing

- Pure model builders per section (e.g. `dashboard-sales-model.ts`) with unit tests, following the `summary-model.ts` pattern.
- RPC coverage via the existing migration/pgTAP patterns — mocked vitest cannot catch missing grants.
- e2e labels: any user-visible string must be greppable in the e2e specs before renaming.

## Cleanup (in scope)

Retire the mock `operationsSnapshot` in `src/features/overview/summary-model.ts` and the unused `operations-overview-client.tsx`. Keep `buildOverviewDashboardSummary` (identity aggregation) — the admin panel consumes it.

## Build order

Each stage merges cleanly on its own if time runs out:

1. `get_dashboard_sales` RPC + KPI row + revenue chart + funnel.
2. Ops-today strip + admin panel (mostly existing code).
3. `get_dashboard_insights` RPC + improvement row.
4. Top lists + custom date range.
5. Overview-mock cleanup + landing-redirect switch.

## Known gotchas to respect

- New tables/functions need explicit grants (RLS alone yields 42501).
- Turbopack in a worktree serves the parent checkout unless `next.config.mjs` sets `turbopack: { root: import.meta.dirname }`; start worktree dev servers via Bash, not `preview_start`.
- Never `git stash` in the shared tree; this work stays in the `feat/owner-dashboard` worktree.
