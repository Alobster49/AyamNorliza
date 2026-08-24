# Orders Page Audit — Worker Report

**Date:** 2026-08-24 · **Branch:** `fix/i18n-logistics-model-prose` (uncommitted polish pass in flight)
**Scope:** `/[locale]/(seller)/[organizationSlug]/orders` — board + table view, cards, drop rules, dialogs.
**Method:** 6-perspective review (design polish, feature gaps, i18n, a11y/mobile, code correctness, cross-page consistency), all findings verified against the current working tree.

---

## TL;DR

The board works and the domain drop-rules layer (`board-rules.ts`) is genuinely good — pure, exhaustive, well-reasoned. But the page ships three trust problems (every open order reads **RM 0.00**, the busiest seller screen is still **English-only** in a Malay-market app, and the "+ New order" button lies in 5 of 6 columns), it is **unusable for drag on a phone** (touch drag hijacks column scroll), and it is the only operational board left **without the hen empty state** the rest of the app just got. Below: fix-first list, feature backlog, polish list, suggested batches.

---

## 1. Correctness & trust — fix these first

| # | Finding | Impact / Effort | Where |
|---|---|---|---|
| 1.1 | **Every non-closed order shows RM 0.00.** `total_amount` is only written by `close_order` (migration `20260810000002`, lines 739–744), yet card and table render `formatPrice(order.total_amount)` unconditionally. Sellers see zeros everywhere and stop trusting the number. Show the amount only for `closed`; render "belum timbang" / unweighed hint otherwise. | high / S | `order-card.tsx:37`, `orders-client.tsx:178` |
| 1.2 | **"+ New order" in every column always creates a *pending* order.** The Delivered column's "+" does the same as Pending's — silently. Scope the control to the Pending column or drop the per-column buttons. | med / S | `orders-board.tsx:196-204,218-221` |
| 1.3 | **`getOrderDetail` failure toast ignores `messageKey`.** Line 99 reads raw English `result.message`; every sibling dialog uses the `messageKey` convention and the keys already exist in both locales. One-line wiring fix. | med / S | `orders-board.tsx:99` |
| 1.4 | **Interrupted confirm-drag dies silently.** A second drag during the async `getOrderDetail` window abandons the first via `detailFetchToken` — correct, but the seller gets no toast, no feedback; the card just snaps back. | low / S | `orders-board.tsx:68-106` |
| 1.5 | `orders-view` localStorage key is device-global, not per-org. Mirrors the products page pattern, so possibly intentional — decide once. | low / S | `orders-client.tsx:29` |

## 2. i18n — busiest seller screen, still English

`order-card.tsx` and `board-dialogs.tsx` are already fully translated; the rest of the page is not. This is the pending seller-ops phase of the i18n rollout landing on its highest-traffic screen.

- `orders-board.tsx` has **no next-intl import at all**: "Move not allowed" toast (l.84), "Error" (l.99), "No orders" (l.209), "New order" (l.220), `Add order to …` aria-label (l.201).
- The six blocked-drop reasons in `board-rules.ts:36-55` are hardcoded strings with no `messageKey` — unlike every RPC error path in `order-actions.ts`.
- `ORDER_STATUS_LABELS` (`types.ts:23-30`) is a static English record feeding columns, tabs, and table badges.
- `orders-client.tsx`: "Board"/"Table"/"New Order", all six table headers, "No orders in this view", "All" tab, "Unknown" fallback.
- Date formatting hardcodes `toLocaleDateString("en-MY")` (l.90-91) instead of `useFormatter()` — `order-detail-client.tsx:93-99` shows the right pattern.
- Also swept up nearby: `weigh-station.tsx:87-88` instruction text, kg/pcs labels (l.60), `FALLBACK_LABELS` / `DELIVERY_FAILURE_LABELS` / `DELIVERY_NEXT_ACTION_LABELS` in `types.ts`.

## 3. Mobile & accessibility

| # | Finding | Impact / Effort |
|---|---|---|
| 3.1 | **Touch drag hijacks vertical scroll.** Cards set `touch-none` and the only sensor is `PointerSensor` with a 6px distance constraint — on a phone, a scroll swipe that starts on a card becomes a drag. `swipe-deck.tsx` already solves this (`pan-y` + axis-aware threshold). Fix: add `TouchSensor` with `{ delay: 250, tolerance: 5 }` (long-press to pick up) or `touch-action: pan-y` + drag handle. | high / M |
| 3.2 | **Board is the default view with no mobile layout.** Fresh session on a 375px phone lands on 6 × `w-72` columns, no snap points, no indicator. Default to table under `sm`, or add `snap-x snap-mandatory` + a column indicator. | high / M |
| 3.3 | **Touch targets under 44px:** column "+" is 24px (`h-6 w-6`), footer/toggle buttons 28px. `weigh-numpad.tsx` uses 64–80px — the standard exists in-repo. | med / S |
| 3.4 | **No `KeyboardSensor`** — keyboard users cannot move cards. Detail page provides a full non-drag path, but nothing announces it; add card `aria-label` ("Open order for {customer}, status {status}"). | med / S |
| 3.5 | Default dnd-kit announcements read raw UUIDs; pass custom `accessibility.announcements` when 3.4 lands. | low / S |

## 4. Feature backlog (what sellers are missing daily)

| # | Feature | Why | Effort | Server change? |
|---|---|---|---|---|
| 4.1 | **Today / Tomorrow delivery-date lens** | `delivery_date` is the seller's real operating axis; board currently shows the org's entire order history (`getOrders` has no date filter, no pagination). Runs page already plumbs `timeZone` + `todayInTimeZone()` — copy that pattern. | M | yes (filter param) |
| 4.2 | **Overdue / at-risk flags** | pending/confirmed with `delivery_date <= today` looks identical to next week's order. Amber/red left border once 4.1 plumbs "today". | S | no |
| 4.3 | **Search box** (customer, zone, id prefix) | Customers + products pages already have one; orders has none. Pure client-side filter. | S | no |
| 4.4 | **One-click Confirm on pending cards** | Confirm dialog defaults every item to available — the common case is zero-edit. Quick action skips the dialog; falls back to it for stock edits. | M | no |
| 4.5 | **Bulk confirm** (morning batch) | Multi-select on Pending column, "Confirm N" bar looping existing RPCs; needs partial-failure UX. | M | no |
| 4.6 | **Call / WhatsApp button on card** | Detail page already renders `tel:`; list query doesn't fetch `phone`. Extend select + `stopPropagation` vs drag. | S | yes (select) |
| 4.7 | Per-column **kg totals** for load planning | RM totals are useless pre-close (see 1.1); kg needs an `order_items` join/aggregate. Later. | L | yes |

## 5. Polish pass (motion + visual)

The redesign spec's bar vs what's on the page today:

- **5.1 Invite/decline during drag — the biggest gap.** Columns only get one undifferentiated ring on `isOver`, legal or not. `resolveDrop` is pure and cheap: pass `activeOrder.status` + `callerRole` down, style legal targets as inviting (`ring-primary bg-primary/5`), illegal as declining (dim + `reason` as a short hint in the header). This is the signature interaction. (high/M)
- **5.2** Card entrance: no mount animation — add `card-enter` keyframe, 30ms stagger via `animationDelay`, reduced-motion guarded. (S)
- **5.3** No hover lift; gate with `hover:hover`. Product cards already have `transition-shadow hover:shadow-md` — decide once, apply consistently. (S)
- **5.4** DragOverlay: no scale/shadow escalation; source "ghost" is just `opacity-40`. Overlay → `scale-105 shadow-2xl`, source → dashed placeholder. (S)
- **5.5** Drop uses default dnd-kit animation; blocked drop only toasts. Custom `dropAnimation` easing + `refuse-shake` keyframe (±4px, ≤300ms). (M)
- **5.6** Count badges static — `count-pop` keyframe keyed on value. (S)
- **5.7** Column empty state is a bare dashed box × 6 — reuse `HenEmptyState` small, or per-status one-liners. (S)
- **5.8** Amounts lack `tabular-nums`; buyer theme already solves this. Card type hierarchy is flat — the price (the number sellers scan for) is `text-xs`, same as metadata badges. (S)
- **5.9** Status colors are stock Tailwind hues (`bg-blue-500`, `bg-purple-500`…) in two separate maps (`types.ts` + `orders-board.tsx`), bypassing the app's oklch token system. Define six `--status-*` tokens once. (M)
- **5.10** No shared easing tokens; add `--ease-enter` / `--ease-move` to `:root` and use them in every new keyframe. (S)

## 6. Consistency with sibling pages

- **6.1 Page-level empty state:** runs, dispatch, loading, tasks, weigh, pack all render `HenEmptyState` when idle. Orders — the highest-traffic screen — still shows six "No orders" boxes. Add `orders.length === 0` → hen, with `orders.empty.*` keys following the `deliveryRuns.empty` convention. (high/S)
- **6.2 View toggle built twice:** products just got a `ViewButton` with `role="group"` + aria-label; orders still uses the older raw-Button pair without group semantics. Extract a shared `view-toggle.tsx`. (S)
- **6.3 Header split 2/4:** products + orders dropped the in-page h1 (sidebar labels the page); customers + runs still have it. Pick one direction repo-wide. (S)

---

## Suggested batches

1. **Batch A — Truth & language (mostly S):** 1.1 RM 0.00, 1.2 "+ New order" scope, 1.3 messageKey wiring, all of §2 i18n, 6.1 hen empty state. Highest value per hour on the board.
2. **Batch B — Phone usability (M):** 3.1 touch sensor, 3.2 mobile default/snap, 3.3 targets. The board is currently desktop-only in practice.
3. **Batch C — Daily-driver features:** 4.1 date lens + 4.2 overdue flags first (they compound), then 4.3 search, 4.4 quick confirm, 4.6 WhatsApp.
4. **Batch D — Motion polish:** 5.1 invite/decline is the one that changes how the board feels; then 5.2–5.10 as a sweep, plus 3.4/3.5 while touching the sensors.

Batch A before D: polish on top of wrong numbers and the wrong language polishes the wrong thing.
