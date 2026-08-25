# Confirm-step pricing + product price removal — design

Date: 2026-08-26
Status: approved (owner picked options via session Q&A)

## Problem

Prices today live in two places that no longer match how AyamNorliza sells:

1. `product_variants.price_per_unit` — a public list price shown on seller
   Products cards/ledger and the buyer shop. But every client has a negotiated
   deal price, so a public list price is wrong and misleading.
2. `order_items.price_per_kg` — entered by the seller only at settlement
   (close), long after the buyer committed. The seller wants to commit the
   price at **confirm** time instead.

## Decisions (owner-approved)

- Price is entered **per line item** at order confirm (RM/kg input beside the
  Available / Not available toggle).
- `product_variants.price_per_unit` is **removed completely** — dropped from
  the DB, the seller Products UI (cards, ledger, size dialog), and the buyer
  shop/cart/checkout. No RM figures anywhere pre-confirm.
- Buyer sees prices **after confirm**: per-line RM/kg once confirmed, full
  totals once closed. Before confirm: no prices.

## Changes

### Database (one new migration)

- `confirm_order(p_order, p_decisions)` — each decision gains `price_per_kg
  numeric` (required for available lines, > 0). Stored on
  `order_items.price_per_kg` at confirm.
- `close_order(p_order, p_lines)` — `price_per_kg` becomes optional per line;
  when omitted the confirm-time price stands. `line_total` stays the generated
  column `final_weight_kg * price_per_kg`; `orders.total_amount` summing
  unchanged.
- `alter table product_variants drop column price_per_unit;`
- Re-grant execute on replaced functions (repo gotcha: no default grants).

### Seller UI

- Order detail pending panel (`order-detail-client.tsx` `PendingPanel`):
  RM/kg numeric input per line. Confirm disabled until every *available* line
  has price > 0. Market-price hint chips (`getPriceHints`) shown at confirm
  (kept at settle too).
- Settlement panel: price field pre-filled from the confirmed
  `order_items.price_per_kg`, still editable (operational adjustments).
- Products page: price display removed from `product-card.tsx`,
  `product-ledger.tsx` (row price + range), and the `variant-dialog.tsx` form
  field.

### Buyer UI

- Shop cards, add-to-cart sheet, cart overlay/view, checkout: all RM figures
  removed. Weight/size/qty info stays. `price-estimate.ts` estimate stack and
  its tests deleted (or reduced to weight-only helpers if shared).
- Scale-chip: keeps weight framing, loses RM range.
- Buyer order page: pending → no prices; confirmed/warehouse/delivery →
  per-line "RM x.xx/kg"; closed → actual totals as today.

### Kept as-is

- KPDN market-price ingest + `get_market_suggestions` RPC (settlement & confirm
  hint chips) — independent of product prices.
- `orders.total_amount`, `order_items.line_total` semantics.

## Out of scope

- Per-piece pricing (settlement prices everything per kg today; confirm follows).
- Customer-specific default price books (future; confirm-time entry covers it).
- Invoicing/receipts.

## Testing

- Unit: confirm action validation (price required/positive for available
  lines), close action with omitted price.
- Existing e2e label coupling: grep specs for renamed/removed copy
  (repo gotcha).
- `npm run typecheck` + vitest suite green; browser smoke of confirm flow.
