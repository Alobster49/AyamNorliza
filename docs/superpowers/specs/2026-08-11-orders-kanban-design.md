# Orders Kanban Board — Design

**Date:** 2026-08-11
**Status:** Approved
**Reference design:** https://shadcnblocks-admin.vercel.app/project-management/issue-kanban-1

## Goal

Redesign the seller Orders page (`/[organizationSlug]/orders`) from a table-only view into a kanban board grouped by order status, following the shadcnblocks issue-kanban layout, while preserving every existing business rule around status transitions.

## Context

- Orders page today: `src/app/(seller)/[organizationSlug]/orders/page.tsx` (server component, `getOrders()`) + `orders-client.tsx` (tabs + table).
- Statuses (`src/features/orders/types.ts`): `pending`, `confirmed`, `ready`, `delivered`, `closed`, `cancelled`, with `ORDER_STATUS_LABELS` and `ORDER_STATUS_COLORS`.
- Status changes are workflows, not simple writes (`src/features/orders/server/order-actions.ts`):
  - `confirmOrder` — pending → confirmed, requires per-item availability decisions.
  - `cancelOrder` — pending/confirmed → cancelled.
  - `completeTask` — warehouse weigh task sets `ready`.
  - Delivery-run completion sets `delivered`.
  - `closeOrder` — delivered → closed, requires final weights and prices per line.
  - `reopenOrder` — closed → delivered.
- No drag-drop library currently in `package.json`. shadcn/ui (radix-rhea style), Tailwind 4, lucide icons.

## Decisions (user-confirmed)

1. **Drag opens workflow dialog** — dragging a card never silently writes status; it triggers the corresponding workflow. Invalid moves bounce back with an explanatory toast.
2. **All 6 statuses as full columns** — horizontal scroll, matching the reference exactly.
3. **View toggle** — `Board | Table` switcher; board is the default; the existing table remains. Choice persisted in `localStorage`.

## Layout

- Header row unchanged: title "Orders", subtitle, "New Order" button.
- Toolbar below header: view switcher (Board | Table), total order count, "Grouped by status" hint.
- Board: 6 columns inside a horizontally scrollable container. Each column:
  - Header: status color dot (hue from `ORDER_STATUS_COLORS`), label, count badge, add-order icon button.
  - Vertically scrollable card stack.
  - Ghost "New order" button at the bottom (routes to `/orders/new`).

## Card

- Mono short order id (`id.slice(0, 8)`) above the title.
- Title: customer name.
- Optional description line: order notes (truncated).
- Footer badges: zone name, delivery date (en-MY short format), total (`formatPrice`, bold), source badge (`portal`/`manual`) in the avatar position.
- Clicking the card navigates to the order detail page.

## Drag rules

| From | To | Behavior |
|---|---|---|
| pending | confirmed | Open confirm dialog (per-item availability). Requires fetching order detail (`getOrderDetail`) on drop, since `OrderListItem` has no items. |
| pending, confirmed | cancelled | Confirmation prompt, then `cancelOrder`. |
| delivered | closed | Navigate to the order detail settlement section (do not rebuild the settlement dialog on the board). |
| closed | delivered | Confirmation prompt, then `reopenOrder`. |
| any other pair | — | Card bounces back; toast explains why (e.g. "Ready is set by the warehouse weigh task"). |

Optimistic updates: for cancel/reopen the card moves immediately and reverts on server-action failure with an error toast. For dialog-gated moves the card moves only after the dialog completes successfully.

## Library

`@dnd-kit/core` + `@dnd-kit/sortable`. Maintained, keyboard-accessible, pointer-based (no HTML5 drag jank).

Rejected alternatives: hand-rolled pointer events (more code, worse accessibility), `@hello-pangea/dnd` (heavier, stiffer column-list model).

## Files

- `src/app/(seller)/[organizationSlug]/orders/orders-client.tsx` — add view state (localStorage-persisted), render switcher, keep the table branch.
- `src/features/orders/components/orders-board.tsx` — new: board, columns, DnD context, drop-rule handling.
- `src/features/orders/components/order-card.tsx` — new: card component.
- Confirm/cancel dialogs: reuse the existing confirm dialog from order detail if extractable; otherwise thin dialog wrappers calling the existing server actions. No new server actions.

## Error handling

- Server action failure after optimistic move: revert card, show error toast with the action's message.
- Detail fetch failure on pending→confirmed drop: bounce card, error toast.
- Empty column: subtle empty state (dashed placeholder or muted text).

## Testing

- Unit (vitest): drop-rule matrix — allowed/blocked pairs map to the right handler; optimistic revert on failure.
- Existing e2e suite must stay green; table view (the e2e-stable path) remains available via the switcher.
