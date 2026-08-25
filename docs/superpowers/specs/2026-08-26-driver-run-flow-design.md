# Driver Run Flow: Start Run, Final Weight at Door, Per-Order Invoice

**Date:** 2026-08-26
**Status:** Approved (approach A, driver weight is final)

## Context

The driver page already exists: `/[locale]/drive/[organizationSlug]` renders
`DriverDeck` (truck label, stop list, arrive / deliver-with-POD / fail flows),
backed by the driver role, RLS run-scoping, and `driver_*` RPCs from the
2026-08-21 migrations. `order_items.line_total` is a generated column
(`final_weight_kg × price_per_kg`) and `close_order` already recomputes
`orders.total_amount` from final weights.

Three gaps remain, which this design closes:

1. A driver cannot start (depart) their own run — only dispatch roles can, via
   `dispatch_depart_truck`. Stop recording fails with `run_not_departed` until
   the office departs the truck.
2. The deliver sheet takes received-by / cash / photo but no weights. Final
   weight is keyed later by a manager via `close_order`.
3. There is no per-order invoice. Only the seller-side run manifest exists.

## Decisions

- **Driver weight is final.** The weights the driver keys at the door set
  `final_weight_kg` / `final_pieces`, append `order_weight_log` rows of kind
  `'final'`, and recompute `orders.total_amount`. The customer pays cash at the
  door based on this. Managers can still amend later through the existing
  order screen / `close_order` path (close remains the settlement step; this
  design does not change order status semantics beyond `ready → delivered`).
- **Extend, don't rebuild.** All work extends the existing drive page, deck
  component, and driver RPC family.

## Architecture

One new migration (`supabase/migrations/20260826000002_driver_run_flow.sql`):

### 1. `driver_start_run(p_run uuid)`

- Gate: caller is the run's `driver_id` (or has a manager/dispatch role — the
  office can start on the driver's behalf, matching the existing
  `?run=` shadowing convention).
- Transition `planned → departed` with the same side effects as
  `dispatch_depart_truck` (release non-ready orders back to the pool). Reuse /
  factor the existing depart logic rather than duplicating it.
- Idempotent-safe: starting an already-departed run raises `invalid_status`
  (mapped to a friendly message client-side).

### 2. `driver_deliver_stop` gains `p_lines jsonb`

- Drop the old 5-arg signature; recreate as
  `driver_deliver_stop(p_order uuid, p_received_by text, p_signature_path text,
  p_photo_path text, p_cash_collected numeric, p_lines jsonb)`.
- `p_lines` validation mirrors `close_order`: every non-cancelled item on the
  order must appear exactly once with a well-formed `item_id` and
  `final_weight_kg > 0`; `final_pieces` optional integer; price always the
  stored confirm-time `price_per_kg` (drivers cannot override price).
- Apply pass: update `order_items.final_weight_kg` / `final_pieces`, insert
  `order_weight_log` kind `'final'` rows, recompute
  `orders.total_amount = Σ line_total`, then the existing deliver behaviour
  (insert `delivery_attempts` outcome `delivered`, order → `delivered`).
- All in one function so weight write + delivery record are one transaction.

## Server actions (`driver-actions.ts`)

- `startRun(organizationSlug, runId)` → `driver_start_run` RPC. Same guard
  (`DRIVER_AND_MANAGER_ROLES`) and error-key mapping pattern as the stop
  actions (`errors.drive.run.*`).
- `deliverStop` gains `lines: { itemId, finalWeightKg, finalPieces? }[]`;
  zod-validated like `completeOrderTask` weights, passed as snake_case jsonb.

## UI

### DriverDeck

- **Run not departed** (`run.status === 'planned'`): the stop card's actions
  are replaced by one large "Start delivering" button → `startRun` → refresh.
  Header shows the truck + stop count as today so the driver can review the
  route before starting.
- **Deliver sheet**: above received-by/cash, one row per order item —
  product name, mode-aware inputs (kg mode: weight in kg; piece mode: pieces +
  weight). Warehouse weight shown as placeholder/hint where present. A live
  computed total (`Σ weight × price_per_kg`) updates as the driver types, and
  becomes the cash placeholder. Confirm disabled until every item has a valid
  weight.
- **Delivered stops**: in the whole-run list and the finished screen, each
  delivered stop links to its invoice.

### Invoice page

New route: `/[locale]/drive/[organizationSlug]/invoice/[orderId]/page.tsx`.

- Server-rendered, print-first (`@media print` like the run manifest).
- Content: org name, invoice number (short order id + date), customer
  name/address/phone, delivery date, per line: product · final kg (and pieces
  where set) · price/kg · line total; grand total (`orders.total_amount`);
  delivered-at timestamp and received-by from the delivery attempt.
- Access: `DRIVER_AND_MANAGER_ROLES` guard + existing RLS (driver only sees
  own run's orders). Guard renders a friendly error like the drive page.
- Only meaningful once delivered: for a not-yet-delivered order, show a
  "not delivered yet" state instead of an invoice.

## i18n

New keys in `en.json` + `ms.json` under `orders.driverDeck` (start button,
weight sheet labels, validation toasts), `drive.invoice.*`, and
`errors.drive.*` additions. Follow the existing message-key test pattern.

## Error handling

- New RPC error codes surface through the existing `stopMessageKey`-style
  mapping: `run_not_departed` (already exists), `invalid_status`,
  `lines_incomplete`, `invalid_weight` → `errors.drive.*` keys.
- Client-side: weight inputs validated before submit (positive numbers);
  submit blocked otherwise, so RPC validation is a backstop.

## Testing

- Unit: extend `driver-run-model.test.ts` (deck states for planned run),
  `driver-actions-message-keys.test.ts` (new error keys), a model test for the
  live-total computation, invoice view model if extracted.
- E2E: extend the order-pipeline spec — driver starts run, delivers with
  weights, order total reflects driver weights, invoice page renders the
  recomputed total.
- Migration: follows repo convention (grants on new/replaced functions —
  see repo gotcha about grants on new tables/functions).

## Out of scope

- Signature capture UI (column exists, untouched).
- PDF file generation — invoice is a printable HTML page (browser print → PDF).
- Any change to seller close/settlement flow.
- Run completion by driver (office still completes via `set_run_status`).
