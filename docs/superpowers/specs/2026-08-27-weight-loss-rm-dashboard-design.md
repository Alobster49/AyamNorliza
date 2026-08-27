# Weight loss in RM on dashboard — design

Date: 2026-08-27
Status: approved (chat)

## Problem

The dashboard "Weight leakage" card shows kg given away only. Owner wants the
money: every order item is weighed at the warehouse (`warehouse_weight_kg`,
"first weight") and again at the door (`final_weight_kg`). The customer pays
`final_weight_kg × price_per_kg` (`line_total`), so any shortfall is revenue
lost versus what the warehouse allocation would have earned.

Example: first weight 10 kg at RM10/kg, final weight 9 kg → earned RM90,
lost RM10.

Wanted: estimated total RM lost, and which orders the loss came from.

## Decisions (confirmed with owner)

1. **Losses only.** Total lost = Σ per item of
   `greatest(warehouse_weight_kg − final_weight_kg, 0) × price_per_kg`.
   Items that weigh MORE at the door (gains) are ignored, not netted.
2. **Placement:** extend the existing Weight leakage card — no new card.

## Approach

Extend the `get_dashboard_insights` RPC (`create or replace` in a new
migration). No new round trips; same delivered/closed + date-range + not
cancelled + both-weights-present filters as the current weight block. Loss
valuation additionally requires `price_per_kg is not null` (unpriced items
cannot be valued; their kg still count in the kg figures).

### RPC payload changes (`weight` block)

- `lostKg` (number) — Σ `greatest(warehouse − final, 0)`, item level
- `lostRm` (number) — Σ `greatest(warehouse − final, 0) × price_per_kg`,
  item level, priced items only
- `byProduct[]` rows gain `lostKg`, `lostRm`; ordered by `lostRm` desc
  (existing `warehouseKg`/`finalKg`/`diffKg` kept)
- new `byOrder[]` — top 10 orders by `lostRm` desc, only orders with
  `lostRm > 0`: `{ orderId, customerName, deliveryDate, lostKg, lostRm }`

Semantic change, intended: the card headline currently nets kg across items
(`sum(first) − sum(final)`), so a gain item shrinks it. The new headline
figures (`lostKg`, `lostRm`) are loss-only and can be larger.

### Model (`src/features/dashboard/analytics/insights-model.ts`)

Extend `InsightsPayload`/`InsightsViewModel` weight types with the fields
above (`WeightByProduct` gains `lostKg`/`lostRm`; new `WeightByOrder` type).
`leakagePct` (net) kept for continuity; new `lossPct = lostKg / warehouseKg`
drives the headline so it cannot go negative when gains outweigh losses.
Pure pass-through mapping otherwise; unit tests updated.

### UI (`insights-row.tsx` → `WeightCard`)

- Headline: "≈ MYR X lost — Y kg given away (Z%)" using `lostRm`, `lostKg`,
  `lossPct` (falls back to the old kg-only summary when `lostRm` is 0).
- Per-product list: each row shows RM lost + kg lost.
- New "By order" section: rows `#SHORTID · customer · date` with RM lost
  right-aligned; whole row links to
  `/{organizationSlug}/orders/{orderId}` via the i18n-aware `Link`.
  Short id = `order.id.slice(0, 8)` (existing convention).
- `hasLeakage` empty-state check switches to `lostKg > 0 || diffKg > 0`.

### i18n

New keys under `analytics.insights.weight` in `en.json` + `ms.json`
(headline with RM, by-order section title, per-row formats). Regenerate /
update `en.d.json.ts` as the repo does for other keys.

### Tests

- `insights-model` unit tests: payload mapping incl. new fields, loss-only
  semantics (gain item excluded from `lostKg`/`lostRm`).
- SQL: extend the dashboard insights RPC pgTAP coverage if present, else the
  RPC change ships with the migration and is covered by model/e2e layers.

## Out of scope

- No changes to weighing flows, order pipeline, or `line_total`.
- No dedicated "losses" page; top-10 in-card list only.
- No change to the pricing/market cards.
