# Dispatch Logistics — Design Spec

Date: 2026-08-13
Status: Approved (brainstorm complete)

## Goal

Redesign delivery logistics for the chicken factory: physical loading bays
containing trucks, postcode-driven coverage zones, automatic order-to-truck
assignment with manual override, and a drag-and-drop dispatch board with a
truck departure animation.

## Context

Existing foundation (migration `20260810000001_order_pipeline_schema.sql`):
`delivery_zones`, `trucks`, `truck_zones`, `delivery_slots`,
`schedule_blocks`, `delivery_runs`, and orders carrying `truck_id`,
`run_id`, `zone_id`, `delivery_date`, `slot_id`. Orders kanban already uses
dnd-kit with a pure drop-resolution state machine (`board-rules.ts`).

This feature adds the missing layer: facility/bays, postcode matching,
auto-assignment, and the dispatch board. New feature module:
`src/features/logistics/`.

## Decisions (from brainstorm)

- Bay = physical loading dock (affects loading workflow, not coverage).
- Coverage = existing zones + postcode ranges per zone (auto-match), not
  pure per-truck postcodes.
- Auto-assign picks the least-loaded covering truck; respects slot caps.
- Auto-assign fires on order confirm, as a suggestion; manual drag always
  wins and is never overridden by re-runs.
- Factory modeled as a `facilities` table with a single row today;
  multi-facility later is an insert, not a migration.

## 1. Data model (new migration)

- **`facilities`** — org-scoped: `name`, `address_line`, `postcode`,
  `state`, `is_active`. Seed one row: "Kilang Ayam — Ptd 7904, Batu 31,
  Kg. Parit Baru, 82000 Pontian, Johor". Writes: `owner` + `org_admin`
  only. Reads: org members.
- **`bays`** — `facility_id` FK, `name`, `position` (sort order),
  `is_active`. Managers CRUD.
- **`trucks.bay_id`** — nullable FK to `bays`. Null = unassigned pool.
- **`zone_postcode_ranges`** — `zone_id` FK, `postcode_start`,
  `postcode_end` (5-char text). Multiple ranges per zone. Cross-zone
  overlap allowed; admin UI flags it; first match wins ordered by zone
  name.
- **`orders`** — add `postcode` (captured at order time) and
  `assignment_source` enum `auto | manual | none` (default `none`).

Untouched: `truck_zones`, `delivery_slots`, `delivery_runs`,
`schedule_blocks`. Coverage chain: postcode → zone (ranges) → trucks
(`truck_zones`) → least-loaded pick.

RLS mirrors the `20260810000001` policy style: org members read,
role-gated writes.

## 2. Auto-assignment logic

Pure function, `src/features/logistics/lib/assignment.ts`:

```
suggestTruck(order, zones, ranges, truckZones, trucks, existingLoads)
  → { truckId, reason } | { blocked, reason }
```

Rules in order:
1. Match `order.postcode` against `zone_postcode_ranges`. No match →
   "unmatched" pool on the board; manual drag required.
2. Zone → candidate trucks via `truck_zones`. Filter: `is_active`, has a
   bay, not blocked by `schedule_blocks` for the delivery date.
3. Drop trucks at `max_orders` cap for the order's date + slot.
4. Least-loaded truck for that date wins; tie-break lowest truck code.

Server: after `confirm_order` RPC succeeds, the server action computes the
suggestion and writes `truck_id` + `assignment_source = 'auto'`. Manual
drag writes `assignment_source = 'manual'`. Auto re-runs (e.g. truck
deactivated) only touch `auto`/`none` orders — never `manual`.

Departure uses existing `delivery_runs`. Once a run departs, its orders
are locked (no drag).

## 3. Dispatch board UI

Route: `/[organizationSlug]/dispatch`. Date picker (default today).

- **Left panel — tickets.** Confirmed/ready orders for the chosen date.
  Groups: *Unassigned* (no postcode match) and *Suggested* (auto-placed,
  ghost-outlined on trucks until departure). Ticket shows customer name,
  zone badge, postcode, slot time, item summary, status chip
  (`confirmed`/`ready`), source badge (`auto`/`manual`).
- **Main area — bays.** Bay columns; truck cards inside. Truck card =
  drop target: name/code, load vs cap (`4/6`), stacked tickets.
- **Drag (dnd-kit, orders-board pattern).** On drag start, compatible
  trucks highlight (zone match + capacity); incompatible dim but remain
  droppable = override, gated by a confirm dialog. Drop writes `truck_id`
  + `assignment_source='manual'`. Drag back to pool = unassign.
- **Departure.** Per-truck "Depart" button (enabled when ≥1 ready order).
  Creates/updates the `delivery_run` → `departed`. Animation: truck card
  slides out and fades; tickets collapse into an "On the road" chip with
  order count. `prefers-reduced-motion` → instant swap. Departed runs show
  in a collapsed strip at the bay bottom, linking to the runs page.

Access: MANAGER_ROLES + `logistics` staff view and drag; depart is
managers + logistics.

## 4. Config & admin

Extend `/[organizationSlug]/delivery` with tabs:

- **Factory** — facility name/address/postcode. Edit gated by a new
  `FACILITY_ADMIN_ROLES = [owner, org_admin]`; read-only for others.
- **Bays** — CRUD + reorder. Truck form gains a bay dropdown. Managers.
- **Zone postcodes** — per-zone range list, add/remove. Validation:
  5-digit, start ≤ end. Cross-zone overlap shows a non-blocking warning
  banner. Managers.

## 5. Error handling

- Concurrent drags on one ticket: last-write-wins with server
  revalidation; stale drop → error toast + board refetch (same race-guard
  pattern as the orders kanban).
- Truck deactivated/blocked while holding orders: those orders return to
  the unassigned pool; toast warns.
- Depart with non-ready orders aboard: dialog — depart without them
  (they stay in the pool) or cancel.

## 6. Testing

Repo pattern: pure lib + unit tests, thin React shells
(`dashboard-shell-model.ts` style).

- `assignment.test.ts` — postcode matching incl. range edges, cap
  filtering, least-loaded tie-break, manual-never-overridden.
- `dispatch-rules.test.ts` — drop resolution state machine: assign,
  unassign, override, blocked-after-departure.
- Postcode validator tests (5-digit, start ≤ end).

## Module layout

```
src/features/logistics/
  components/   dispatch-board, bay-column, truck-card, ticket, depart-animation
  lib/          assignment.ts, dispatch-rules.ts, postcode.ts
  server/       dispatch-actions.ts, facility-actions.ts, guards
  tests/unit/
src/app/(seller)/[organizationSlug]/dispatch/
supabase/migrations/<ts>_logistics_dispatch_schema.sql
```

## Out of scope (YAGNI)

Geospatial routing / lat-lng distance, driver master data, live truck
tracking, driver mobile app, multi-facility UI (schema supports it; UI
shows one).
