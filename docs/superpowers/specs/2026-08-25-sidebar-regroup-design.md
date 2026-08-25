# Sidebar regroup — split Sales into Sales + Fulfillment

**Date:** 2026-08-25
**Status:** Approved approach A (pure regroup, no renames, no route changes)

## Problem

The owner sidebar's "Sales" group holds 10 items. Half are not sales: Delivery
setup, Dispatch, Loading, Delivery runs, and Warehouse tasks are fulfillment
work jammed under the Sales heading.

## Design

Split the `Sales` route group in
`src/features/dashboard/components/dashboard-shell-model.ts` into two groups:

- **Sales** — Dashboard, Products, Orders, Customers, Market prices
- **Fulfillment** (new) — Warehouse tasks, Dispatch, Loading, Delivery runs,
  Delivery setup

Within Fulfillment the order follows the daily flow (tasks → dispatch →
loading → runs), with Delivery setup last because it is rarely touched.

Access control and System groups are unchanged. The staff-only "Warehouse"
branch (inventory/logistics roles) is unchanged. No hrefs, segments, or page
titles change — this is purely which heading each existing item sits under.

## Changes

1. `dashboard-shell-model.ts` — split the `routeGroups` array; new group uses
   `sectionKey: "sections.fulfillment"`.
2. `src/messages/en.json` — add `dashboard.sections.fulfillment: "Fulfillment"`.
3. `src/messages/ms.json` — add `dashboard.sections.fulfillment: "Logistik"`
   (distinct from "Persediaan penghantaran" / "Penghantaran" already used for
   delivery pages; owner may veto during copy review).
4. `src/messages/en.d.json.ts` — regenerate / extend the sections type the same
   way the file is normally produced.
5. `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts` — Access
   control assertions index `groups[1]`; after the split it is `groups[2]`.
   Add one assertion for the new Fulfillment group's key and item order.

## Out of scope

Renames, item reordering inside Sales, icons, collapsible behavior, buyer or
staff sidebars, `getDashboardPageContext` behavior (works unchanged — active
section resolves via the same group scan).

## Testing

- Unit: updated `dashboard-shell-model.test.ts` passes.
- e2e: `e2e/dashboard-shell.spec.ts` references "Sales" only in a comment; no
  label assertions break. Run the dashboard shell spec to confirm.
- Manual: owner sidebar shows 4 groups (Sales, Fulfillment, Access control,
  System); staff roles still see only Warehouse.
