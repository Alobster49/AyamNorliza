# Order detail redesign — Journey Bar + One Big Job

Date: 2026-08-23. Chosen from five mockup concepts ("Order Page, Five Ways"
artifact): Concept 01 (Journey Bar) as the skeleton on every state, Concept 02
(One Big Job) grafted onto the two states staff struggle with, Pending and
Delivered.

## Problem

The seller order detail page (`src/app/(seller)/[organizationSlug]/orders/[orderId]/order-detail-client.tsx`)
gives no lifecycle orientation (one status badge), no action guidance, a bare
three-input settlement form with a confusing "RM 0.00" total, cramped mobile
layouts, and hides the customer phone that is already loaded.

## Design

### Journey Bar (all states)

- A five-step progress bar under the header: Placed → Confirm → Warehouse →
  Deliver → Settle. Done segments green, current amber, future muted.
- Desktop/tablet (`sm:` up): labels under the segments. Mobile: labels hidden,
  compact "Step N of 5 — <label>" line instead.
- Status → step mapping: pending=2, confirmed/ready=3 (ready shows Warehouse
  done, current = Deliver → step 4), delivered=5, closed=all done.
- Cancelled: no bar; keep the existing notice card.
- Next-action banner: one sentence per state saying what this screen wants and
  what the primary action triggers downstream. Amber-tinted card, icon, bold
  first line. Cancelled/closed get neutral variants (no action pending).

### One Big Job — Pending

- Availability check framed as the task: banner copy "Check stock for N items.
  Mark each line, then confirm. Confirming creates the warehouse task."
- Item rows keep the Available / Not available toggle (existing behavior,
  segmented-control styling).
- Primary CTA full-width on mobile: "Confirm order". Cancel stays secondary.

### One Big Job — Delivered (settlement)

- Task card leads: "Enter final weight & price", with the delivery date.
- Final weight prefilled from `warehouse_weight_kg` (already done today) and
  visually marked as prefilled; pieces optional.
- Market price hint chip per line when a suggestion exists: fetched via a new
  `getPriceHints` server action (wraps the shipped `get_market_suggestions`
  RPC through the orders guard). Chip matched by product name; only non-stale,
  non-null suggestions shown. Tapping the chip fills the price input.
  No suggestion → no chip; the form works exactly as before.
- Sticky bottom bar on mobile (static card on desktop): running total + Close
  order button. Total shows an em dash until every line has weight + price,
  instead of a misleading RM 0.00.
- Delivery details (zone/truck/address) collapse into a fold on this state so
  the task owns the screen.

### Out of scope

Timeline/audit join (Concept 03), workbench split (04), checklist rebuild
(05), buyer portal pages, any data-model change.

## Data

- No schema changes. New read-only server action in
  `src/features/orders/server/order-actions.ts`: `getPriceHints(slug)` →
  `MarketSuggestion[]` guarded by `MANAGER_ROLES`, called from the client only
  when the order is in `delivered`.
- Customer phone: already in `OrderWithItems`; surface it in the header block.

## Components

- `src/features/orders/components/journey-bar.tsx` — presentational; props
  `{ status: OrderStatus }`; exports `journeySteps` mapping for tests.
- `src/features/orders/components/next-action-banner.tsx` — presentational;
  copy table keyed by status (+ item count for pending).
- Panels stay in `order-detail-client.tsx`; Delivered panel gains the price
  chip + sticky total; Pending panel gets task framing.

## Testing

- Unit (vitest): journey step mapping per status; banner copy per status;
  price-hint matching (product name → suggestion, stale filtered, absent →
  none); settlement total shows "—" until complete.
- Existing tests must stay green: `npx vitest run`.

## Verification

Typecheck + lint + vitest; dev server visual pass over pending, confirmed,
ready, delivered, closed states at 375px and desktop widths.
