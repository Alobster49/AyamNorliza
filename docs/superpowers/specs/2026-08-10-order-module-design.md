# Order Module Redesign — Unified Pipeline with Scheduling, Weighing & Settlement

**Date:** 2026-08-10
**Status:** Approved design (Approach B — full ops build)
**Replaces:** `orders`/`order_items` (seller manual) and `buyer_orders`/`buyer_order_items` (portal) — dev data only, dropped freely.

## Context

AyamNorliza sells chicken through a buyer portal and manager-keyed orders. Today the two flows use separate tables and a generic status enum, with no delivery scheduling, no size handling, no weighing workflow, and no per-order pricing. The real operation works like this:

1. A customer orders chicken by piece (usual) or by kg (bulk), specifying a per-bird size range (e.g. 1.5–1.7 kg) and a pre-declared fallback if that size is unavailable.
2. A manager checks stock and confirms, applying the fallback where needed.
3. Warehouse staff allocate the birds to a truck lot bay, weigh them, and mark the task done.
4. The truck delivers; the customer re-weighs on receipt; the driver notes final weights on paper and hands the list to the manager.
5. The manager keys final weights and the day's price per kg (chicken price fluctuates; each customer gets their own price), which closes the order.

All orders — piece and kg mode — settle as **final total weight × price per kg**. Piece counts are recorded for reference.

## Confirmed decisions

- One unified order pipeline for portal and manager-created orders.
- Delivery locations are a fixed zone list; customers pick a zone plus a street address.
- Trucks are assigned to zones (`truck A → zones 1,2,3`). Weekly recurring delivery slots per truck, with one-off blocked dates and per-slot order capacity.
- Order lines carry: mode (`piece`|`kg`), quantity, size range (min–max kg per bird), and a fallback choice — `cancel`, `mix`, `upsize`, or `downsize` — declared at order time so no confirmation round-trip is needed.
- Manager keys price per kg at close; no stored price list (market price moves daily).
- Roles are reused: manager capabilities for `owner`/`org_admin`/`seller`; staff capabilities for `inventory`/`logistics`. Customers use existing buyer auth.
- Approach B extras included: `order_tasks` (staff assignment), `delivery_runs` (truck manifests), `order_weight_log` (immutable weight audit), slot capacity limits.

## Data model

All tables org-scoped with RLS following existing patterns (`supabase/migrations/20260718000001_seller_role_and_catalog.sql`).

### Scheduling

- `delivery_zones` — `id, organization_id, name, display_order, is_active`
- `trucks` — `id, organization_id, name, code, is_active`
- `truck_zones` — `truck_id, zone_id` (coverage join table)
- `delivery_slots` — `id, organization_id, truck_id, weekday (0–6), start_time, end_time, max_orders int null, is_active` (weekly recurring pattern)
- `schedule_blocks` — `id, organization_id, block_date, truck_id null (null = all trucks), reason`

Available options for a customer: zone → trucks covering it (`truck_zones`) → their active slots → concrete dates in the booking window (next 14 days, starting tomorrow), minus `schedule_blocks`, minus slots at capacity.

"Lot bay" is the truck's loading bay — one per truck, so grouping by truck is grouping by bay. No separate bay entity.

### Orders

- `orders` — `id, organization_id, customer_id, status, source ('portal'|'manual'), zone_id, delivery_address, delivery_date, slot_id, truck_id, run_id null, notes, closed_at, created_at, updated_at`
- `order_items` — `id, order_id, product_id, mode ('piece'|'kg'), quantity numeric (birds when mode=piece, kg when mode=kg), size_min_kg numeric, size_max_kg numeric, fallback ('cancel'|'mix'|'upsize'|'downsize'), fallback_applied (same enum, null), warehouse_weight_kg null, warehouse_pieces int null, final_weight_kg null, final_pieces int null, price_per_kg null, line_total numeric generated (final_weight_kg × price_per_kg)`
- `buyers.customer_id` — new FK linking a portal account to its CRM `customers` row, so both order sources share one customer identity.

### Ops (Approach B extras)

- `order_tasks` — `id, organization_id, order_id, type ('allocate_weigh'), assigned_to member null, status ('pending'|'done'), done_by, done_at`
- `delivery_runs` — `id, organization_id, truck_id, run_date, status ('planned'|'departed'|'completed'), notes`
- `order_weight_log` — `id, order_item_id, kind ('warehouse'|'final'), weight_kg, pieces, recorded_by, recorded_at` — append-only; no update/delete policies.

Dropped: `orders`, `order_items`, `buyer_orders`, `buyer_order_items` (old shapes), rebuilt as above.

## Status lifecycle

```
pending → confirmed → ready → delivered → closed
              ↘ cancelled (any point before closed)
```

- **pending** — created by portal checkout or manager. Slot validated at submit: truck covers zone, date/time matches an active slot, date not blocked, capacity not exceeded (checked transactionally).
- **confirmed** — manager stock check. Per line: size range available → confirm; unavailable → apply the customer's pre-declared fallback and record `fallback_applied`. Fallback `cancel` cancels the line (order cancelled if all lines cancel). Confirmation creates the `order_tasks` row and attaches the order to the `delivery_runs` row for its truck + date (created on demand).
- **ready** — staff completed the task: stock allocated to the truck bay, warehouse weight and pieces keyed (written to item + `order_weight_log`), task marked done. All tasks done → order ready.
- **delivered** — manager marks the run completed when the truck returns; all the run's orders move to delivered.
- **closed** — manager keys final weight, final pieces, and price per kg for each line (from the driver's paper list). Total = Σ(final_weight_kg × price_per_kg). Final weights logged. Orders are immutable after close; reopening requires `org_admin`/`owner` and is audit-logged.
- **cancelled** — by customer (while pending), by fallback, or by manager; reason stored in notes.

## Permissions

| Capability | owner / org_admin / seller | inventory / logistics | buyer |
|---|---|---|---|
| Place portal order, view own orders | — | — | ✓ |
| Create manual order, confirm, cancel | ✓ | — | — |
| Runs, manifests, mark delivered | ✓ | — | — |
| Settlement (final weights, price, close) | ✓ | — | — |
| Schedule admin (zones, trucks, slots, blocks) | ✓ | — | — |
| View daily tasks, key warehouse weight, mark done | ✓ | ✓ | — |

## Screens

### Customer (buyer portal — rebuilt)

- **Shop:** existing grid. Add-to-cart dialog gains mode (piece/kg), quantity, size-range inputs (min–max kg per bird), and a fallback picker in plain words: "Can't get this size? → Cancel my order / Mix sizes / Bigger is ok / Smaller is ok".
- **Checkout:** pick zone → street address → only valid dates and time windows for that zone are offered → submit.
- **Orders:** status timeline. Shows `fallback_applied` badge when the manager applied a fallback; after close shows final weights, price per kg, and total.

### Manager (seller app)

- **Orders queue:** tabs by status with pending-count badge.
- **Order detail:** per-line stock check — "size range available?" yes/no; "no" reveals the customer's fallback with one click to apply. Confirm assigns the run and creates tasks.
- **Runs:** date picker → trucks → orders per run; printable manifest page; "truck returned" button marks the run completed (orders → delivered).
- **Settlement:** delivered orders list; per line key final weight, pieces, price per kg; live total; close button.
- **Schedule admin:** zones CRUD, trucks CRUD, truck–zone matrix, weekly slot grid with capacity, blocked-dates calendar.

### Staff (seller app, restricted nav)

- **Today's tasks:** grouped by truck/bay. Each card shows order, customer, lines with size ranges and applied fallbacks; inputs for warehouse weight and pieces; a Done button. Nothing else in their nav.

## Error handling

- **Slot race:** capacity re-validated inside the checkout transaction; loser sees "slot just filled, pick another".
- **Weight sanity:** warn (not block) when final weight deviates more than 20% from warehouse weight, or when average per-bird weight falls outside the ordered size range. Manager can proceed.
- **Close is terminal:** no edits after close; reopen restricted to `org_admin`/`owner` and audit-logged.
- **Fallback = cancel:** communicated on the customer's order page with the reason; no silent cancellation.

## Testing

- **Unit:** slot generation (zone → valid dates/times, blocks, capacity), settlement math, fallback application, status transition guards.
- **E2E:** happy path (order → confirm → ready → delivered → closed), cancel-fallback path, slot-full path.
- Existing suites stay green.

## Out of scope (explicitly)

- Driver app or driver logins — drivers stay on paper.
- Push/email notifications — portal status is the channel for now.
- Stored per-customer price lists — price keyed at close.
- Stock/inventory counting — manager checks stock physically; the system records the outcome only.
- Payment processing.
