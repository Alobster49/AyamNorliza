# Dispatch page — UI/UX polish review

**Date:** 2026-08-20
**Scope:** `/{org}/dispatch` — the three views (Plan, Timeline, Board) and the shell that wraps them.
**Method:** code read of every component in `src/features/logistics/components/`, plus live inspection of the running app at 1440×900, 768×1024 and 375×812 against the seeded pilot org, on a day with data (2026-08-20) and a day without (2026-09-15).

**Out of scope:** the `/loading` screen, the underlying RPCs, and the follow-ups already logged in `.superpowers/sdd/progress.md` (org timezone, `capacity_kg` write UI, optimistic loading updates). Where a finding here overlaps one of those, it is marked *(logged)*.

---

## 1. The headline problem

The feature works. It does not yet *read* as finished, and the reason is consistent across all three views:

1. **Nothing on the page tells you the state of the day.** No count of orders, unassigned, ready, kilograms, or trucks out. Every view makes the dispatcher count cards to answer "am I behind?"
2. **The empty states are wrong, not just plain.** On a day with no orders the Plan view says *"Pool is empty — every order for this date has a truck."* That is a false statement, shown at the exact moment a new user is trying to understand the screen.
3. **The feature ignores the design system.** Not one file under `src/features/logistics/components/` imports from `src/components/ui/`. Tabs, dialogs, badges, buttons, selects and inputs are all hand-rolled here, while `orders/` uses the shadcn primitives. That is where the "slightly off" feeling comes from — different radii, different heights, different focus rings, and two dialogs with no focus trap.
4. **Touch targets are desktop-sized.** Date input 30px, tabs 36px, Plan depart 36px, Board depart ~24px. The Board's most destructive control is its smallest.
5. **Spacing has no scale.** `gap-4` shell, `gap-3` deck, `gap-2` rail, `gap-1` lists, `p-3` cards, `p-2` tickets, `py-0.5`/`py-1`/`py-1.5` badges. Nothing is wrong individually; together there is no rhythm.

Fixing 1–3 is most of the perceived quality gap. The rest is detail work.

---

## 2. Cross-cutting

### C1 — Header collapses badly on mobile
`dispatch-client.tsx:48-81` is a single `flex-wrap` row: title, date, facility, then tabs pushed by `ml-auto`. Below ~640px the tabs wrap to their own line and hang right, leaving a ragged two-row header; the facility line is `hidden sm:inline`, so on a phone the worker loses the depot context entirely.

**Fix:** two explicit rows. Row 1: title + date control + facility (truncated, not hidden). Row 2: the view switcher as a full-width 3-column segmented control on mobile, auto-width from `sm:` up.

```
grid w-full grid-cols-3 sm:flex sm:w-auto
```

### C2 — The selected tab reads as unselected in dark mode
The active chip is `bg-background` (`dispatch-client.tsx:72-74`). Measured in the running app, that resolves to `lab(2.75 0 0)` — near-black — sitting inside a `bg-muted` track that is *lighter*. So the selected tab is the dark hole and the two inactive tabs look lit. There is also no `hover:` state at all.

**Fix:** use the existing `ui/tabs.tsx`, or at minimum add `ring-1 ring-border text-foreground` to the selected chip and `hover:text-foreground` to the rest.

### C3 — Date control is a bare native input
`dispatch-client.tsx:50-59`: `<input type="date">` with `rounded border px-2 py-1`, measured 30px tall. It does not match `ui/input.tsx`, it is under the touch minimum, and stepping a day requires opening the native picker.

**Fix:** `Input` component + a `‹ Today ›` cluster (prev day / Today chip / next day), each ≥44px. Day-stepping is the motion a dispatcher actually repeats.

### C4 — No day summary
Add one stat strip under the header, shared by all three views, fed from the data already in memory:

> **18 orders · 4 unassigned · 11 ready · 612 kg · 1 of 3 trucks out**

Each number is a filter when clicked. This single addition answers the question every view currently forces you to count for.

### C5 — Date changes give no feedback
`dispatch-client.tsx:33` throws away the pending flag: `const [, startTransition] = useTransition()`. Change the date and you stare at the previous day's data until the round trip lands, with no spinner and no dimming.

**Fix:** keep `isPending`; dim the view container (`opacity-60 transition-opacity`) and show a spinner in the date control. Add a `Skeleton` for the first paint.

### C6 — Adopt a spacing scale
Proposed, and it is close enough to what is already there that the diff is small:

| Level | Token | Use |
|---|---|---|
| Page sections | `gap-6` | header → stat strip → view |
| Within a view | `gap-4` | banner → rail/grid |
| Card padding | `p-4` | truck cards, exception cards, bay columns |
| Inside a card | `gap-3` | header → list → action |
| List rows | `gap-2` / `p-3` | tickets, queue rows |
| Chips | `px-2 py-1` | one badge size, from `ui/badge.tsx` |

Today's `p-2` ticket cards and `py-0.5` badges are the two most visible offenders.

### C7 — Eight empty-state strings for four conditions
Currently in the tree:

- "No unassigned orders for this date." — `dispatch-board.tsx:34`
- "Pool is empty — every order for this date has a truck." — `plan-deck.tsx:265-267`
- "No orders yet." — `plan-deck.tsx:76`
- "Drop orders here" — `truck-card.tsx:69-71`
- "No trucks in this bay." — `dispatch-board.tsx:185`
- "No active trucks in any bay." — `plan-deck.tsx:282`
- "No trucks on the board for this date." — `timeline-view.tsx:131`
- "Nothing scheduled for this date." — `timeline-view.tsx:150`

**Fix:** one `<EmptyState icon title hint action />` component and one copy table:

| Condition | Title | Hint | Action |
|---|---|---|---|
| No orders exist for the date | No orders for 15 Sep | Orders appear here once they are scheduled for delivery. | Go to Orders · Jump to today |
| Orders exist, pool empty | Every order has a truck | Nothing left to assign for this date. | View the Board |
| Truck has no orders | Empty | Drag orders here, or run the auto-plan. | Auto-plan |
| No trucks configured | No trucks in service | Add a truck and assign it to a bay to start dispatching. | Delivery setup |

The distinction that matters and is missing today: **"no data yet" and "all work done" are opposite outcomes and currently look identical.**

### C8 — No legend
Green / amber / red / dashed carry the whole meaning of the Timeline and half the Board, and are never explained. Colour is also the only encoding — this fails for colour-blind users and on the monochrome sheets these screens get printed on. Add a legend row (the labels already exist in `STATE_LABEL`) and a leading dot or icon per state.

### C9 — The page does not fill its space
At 1440×900 every view leaves roughly 60% of the viewport empty below the content, with no background, no boundary and no footer. It reads as a broken page rather than a quiet day. Give the view container a `min-h-[60vh]` and put the empty state in the optical centre of that box.

---

## 3. Plan view — `plan-deck.tsx`

### P1 — Dismissing the draft is permanent *(bug, not polish)*
`dismissed` (`plan-deck.tsx:130`) is component state that nothing ever resets. `PlanDeck` is not remounted when the date changes, so: dismiss Wednesday's draft, switch to Thursday, and Thursday's draft banner never appears. The dispatcher's only route back is a full page reload.

**Fix:** reset on date change (`useEffect` on `date`, or key the component by date), and add a "Show draft" affordance in the rail once dismissed.

### P2 — Empty-day copy is false
`plan-deck.tsx:264-268` renders "Pool is empty — every order for this date has a truck." whenever `poolCount === 0`, including when there are zero orders. Verified on 2026-09-15. Branch on `data.orders.length === 0` and use the C7 table.

### P3 — The rail holds a 300px column of nothing
`lg:grid-cols-[300px_1fr]` (`plan-deck.tsx:210`) is unconditional, so on a quiet day an empty 300px gutter shoves the truck cards to the right of the screen. Collapse to a single column when `proposals.length + exceptions.length === 0`.

### P4 — "Proposed · 0"
`plan-deck.tsx:250-252` renders the heading at zero, directly above the "pool is empty" card — a header for a list that is not there, contradicting the card beneath it. Render only when non-empty.

### P5 — Weight column wraps
`plan-deck.tsx:68-70`. In the `xl:grid-cols-3` layout the truck card is narrow enough that `25.0 kg` breaks across two lines while the customer name truncates. The `ml-auto` span needs `whitespace-nowrap shrink-0`, and `min-w-0` belongs on the name span, not the wrapper.

### P6 — "loaded" is bare text, not a badge
`plan-deck.tsx:67` renders a plain green word between the name and the weight. It is the most operationally significant flag on the card and the least visible. Use `ui/badge.tsx` with a check glyph, and match whatever the Board ends up using (see B6).

### P7 — "Depart · 0 of 0 ready"
`plan-deck.tsx:104-111`. On an empty truck the label is nonsense and the disabled state is only `opacity-40` — no `cursor-not-allowed`, no tooltip, still looks pressable. Swap the label to "Nothing to depart" at `load === 0`, add the cursor and a `title` explaining the block.

### P8 — Bay grouping is discarded
`plan-deck.tsx:142` does `view.bays.flatMap((b) => b.trucks)`, so the Plan grid is a flat list of trucks with no indication of physical location — while the Board organises the identical trucks by bay. A loader reading the Plan cannot tell where to walk. Add a bay chip to each card, or group the grid under bay subheadings.

### P9 — Truck ticket list dead-ends at five
`plan-deck.tsx:64,73-75`: "+3 more" is text, not a control. Make the card expandable, or make "+N more" a button that opens the truck in the Board view.

### P10 — Ticket rows are too thin to verify a proposal
Each row is customer + optional "loaded" + weight. Missing the slot time and the zone/postcode — the two facts you need to sanity-check an auto-assignment without leaving the page. Add a second line: `09:00–12:00 · Zone 2 · 82200`.

### P11 — The dial hides the number that matters
`Dial` is 48px with 11px numerals in a 36px hole, showing a percentage; the actual kilograms sit in the 12px muted subtitle. On a warehouse screen the load in kg is the headline. Either enlarge the dial to 64px with `kg` as the centre value and the percentage as the ring, or replace it with a horizontal capacity bar and a large tabular `89.0 / 120 kg`.

### P12 — Override select is uncontrolled and unexplained *(logged)*
`plan-deck.tsx:224-242`: `defaultValue=""` means re-picking the same truck never refires `onChange`. It also lists every non-departed truck with no indication of *why* the exception happened or which trucks are least bad. Use `ui/select.tsx` as a controlled component, order the options by proximity/spare capacity, and show the exception reason inline.

### P13 — One shared `isPending` disables everything *(logged)*
`plan-deck.tsx:129` gates every depart button and every override select. Departing truck A greys out truck B. Track a pending id per action.

### P14 — Draft banner is all-or-nothing and scrolls away
`plan-deck.tsx:182-208`: "Accept 12" is the only path — a dispatcher who disagrees with one proposal must accept all and then fix it on the Board. Add per-proposal accept/skip in the rail, and make the banner `sticky top-0 z-10`.

### P15 — Accepting produces no visible change beyond a toast
The `+N proposed` chips silently vanish and the cards re-render. Flash the newly-assigned rows (a brief highlight, respecting `prefers-reduced-motion`) so the eye can confirm what moved.

---

## 4. Timeline view — `timeline-view.tsx`, `timeline-model.ts`

### T1 — On a single-slot day every block spans the whole axis
Verified on 2026-08-20: window 09:00–12:00, and both blocks render edge to edge because the slot *is* the window. The chart conveys nothing. `timeline-model.ts:83-85` derives the window from the data with only a 120-minute floor.

**Fix:** pad the derived window by ±60 minutes, or anchor it to facility operating hours (06:00–18:00) and let the blocks sit inside it. Bars must be visibly shorter than the axis for the axis to mean anything.

### T2 — Trucks with no deliveries show an empty grid and no message
The `rows.length === 0` guard (`timeline-view.tsx:130-132`) only fires when there are no *trucks*. With trucks and no orders — the common empty day — you get a full 06:00–14:00 grid with blank rows and no explanation. Add a per-row ghost ("No deliveries") and a whole-grid empty state when the block count is zero.

### T3 — The now-line is unlabelled and drawn per row
`timeline-view.tsx:120-126` renders a 2px `bg-primary` bar inside each row, so it visually breaks at every row border and carries no time. It is the most useful mark on the chart.

**Fix:** render it once, absolutely positioned across the whole grid body, with a small time chip at the top ("10:32").

### T4 — Blocks are not interactive
No click, no keyboard focus, no drag to re-slot. The only detail channel is the `title` attribute, which does not exist on touch. Make each block a `<button>` opening a popover with customer, slot, weight, status and a link to the order.

### T5 — Blocks are too small to read, and `min-w-16` causes overlap
40px tall with 11px/10px text. A 15-minute delivery on an 8-hour window is ~3% wide, so `min-w-16` (64px) forces it wider than its true slot and it overlaps the next block — the lane logic cannot help, because the overflow is a rendering minimum, not a data overlap. Raise the block height to 48px and 12px/11px text, and below ~80px collapse the block to a dot with initials, detail in the popover.

### T6 — Header and body compute the grid two different ways
The hour header uses `gridTemplateColumns: 140px repeat(n-1, 1fr)` (`timeline-view.tsx:74`) while the body positions blocks by percentage of the span (`:98`). They agree today only because both are linear from the same window. Any change to window padding (T1) desyncs the labels from the gridlines. Derive both from one shared function.

### T7 — Row header cramped and off-rhythm
140px fixed, `px-3 py-2`, `text-[10px]` meta against blocks offset by 8px. Widen to 160px, use the standard `p-3`, and align the first block's top edge to the header's text baseline.

### T8 — Small tablets get a silent horizontal scroll
`min-w-[720px]` inside `overflow-x-auto` at the `md` breakpoint (768px) leaves a scrolling chart on a 768–800px tablet with no scroll hint. Add an edge fade, or drop to the agenda layout below 900px.

### T9 — Phone agenda is a flat tinted list
`timeline-view.tsx:137-152`: every card is fully tinted by state, with no hour grouping, no date header and no truck filter. Group by hour with sticky time headers, and reduce the tint to a 3px left border so the text stays legible.

### T10 — "N at risk" is a dead chip
`timeline-view.tsx:63-67` reports the count with no way to act. Make it a filter toggle that isolates the at-risk blocks.

### T11 — "N unassigned (not shown — see Plan)"
Correct but passive; it names another tab instead of linking to it. Make it a button that switches views.

### T12 — Now-line uses browser time, not org time *(logged, m5)*
`timeline-view.tsx:23-38` builds "today" and "now" from the browser locale. A laptop on UTC puts the line 8 hours off for a Malaysian depot. Resolve against the org's `Asia/Kuala_Lumpur` setting.

---

## 5. Board view — `dispatch-board.tsx`, `truck-card.tsx`, `ticket-card.tsx`

### B1 — Drag and drop does not work on a phone
`PointerSensor` with a 4px activation distance (`dispatch-board.tsx:58`) lives inside an `overflow-x-auto` row. On touch, the drag gesture and the horizontal scroll fight each other; and at 375px the pool column (`w-72`) fills the screen, so the drop targets are off-canvas anyway. Confirmed at 375×812: the Board is effectively unusable on a phone.

**Fix:** below `md`, replace DnD with tap-to-assign — tap a pool card, open a `ui/sheet.tsx` listing compatible trucks first (`compatibleTruckIds` already computes this), incompatible below with the reason.

### B2 — Modals are hand-rolled
`dispatch-board.tsx:193-240` builds both the override and the depart-confirm dialogs as raw `fixed inset-0` divs: no focus trap, no Escape handling, no `role="dialog"`, backdrop not dismissible, and the confirm button is not autofocused. `ui/dialog.tsx` exists and is used elsewhere in the app. Swap both.

### B3 — Depart is the smallest control on the board
`truck-card.tsx:54-61`: `px-2 py-1 text-xs`, roughly 24px tall, sitting flush against the load counter. The most consequential and least reversible action on the page. Give it `ui/button.tsx` at `size="sm"` minimum (36px, 44px on touch), separate it from the counter, and use a destructive-adjacent tone.

### B4 — Ticket cards omit the operational numbers
`ticket-card.tsx` shows status, zone, postcode and assignment source — but no weight, no slot time and no loaded pill *(m8 logged)*. Weight and slot are precisely what a dispatcher balances trucks on. Add both; keep the card to two lines.

### B5 — Empty pool has no drop affordance
`dispatch-board.tsx:33-35` shows a bare sentence. The pool is a drop target — unassigning is done by dragging back into it — but when empty it looks inert. Mirror `TruckCard`'s dashed "Drop orders here" zone.

### B6 — No counts on column headings
"Order pool" and "Bay A" carry no numbers (`dispatch-board.tsx:29,172`). Add "Order pool · 12" and "Bay A · 2 trucks · 18 orders · 340 kg".

### B7 — Inconsistent column widths
Pool `w-72`, bays `w-80` (`dispatch-board.tsx:27,171`). The pool is the working column and should be at least as wide, and ideally `sticky left-0` so it stays visible while scrolling through bays.

### B8 — Departed trucks lose their contents
`truck-card.tsx:25-31` collapses to a single dashed line. There is no way to see what went out on that truck without leaving the page. Make the line expandable, or link it to the run.

### B9 — Keyboard users cannot use the Board at all
Only `PointerSensor` is registered. dnd-kit ships `KeyboardSensor` plus screen-reader announcements, and neither is wired up. Add `KeyboardSensor` with `sortableKeyboardCoordinates`, and supply `accessibility.announcements`.

### B10 — Blocked drops teach nothing
`resolveDispatchDrop` returns a reason, but it surfaces as a destructive toast *after* the drag (`dispatch-board.tsx:117-120`). The dim/highlight pass already marks compatibility during the drag; add a tooltip on the dimmed truck so the reason is readable before the effort is spent.

### B11 — No bulk assign
Sixty orders is sixty drags. Add checkbox multi-select in the pool with a single "Assign N to…" action — the same code path `applyPlan` already uses.

---

## 6. Suggested order of work

**P0 — wrong, not merely unpolished (half a day)**
- P1 draft dismissal never resets across dates
- P2 false "every order has a truck" copy
- T1 blocks spanning the entire axis
- C2 inverted tab selection in dark mode

**P1 — worker-critical (1–2 days)**
- C4 day summary strip
- B1 phone tap-to-assign
- B3 depart touch target, C3 date control
- B2 real dialogs
- C7 unified empty states
- T2 timeline empty rows, T3 labelled now-line, C8 legend

**P2 — polish (1–2 days)**
- C1 header layout, C5 pending feedback, C6 spacing scale, C9 min-height
- P3–P11 (rail collapse, headings, wrapping, badges, bay chips, richer rows, dial)
- T5, T6, T7, T9 (block sizing, shared grid, row header, agenda grouping)
- B4–B7 (ticket contents, pool affordance, counts, widths)

**P3 — after the above**
- P12–P15, T4, T10, T11, B8–B11

A reasonable first pull request is the P0 group plus C4 and C7: four real defects, the summary strip, and one empty-state component. That is roughly a day and it changes the perceived quality of the page more than the whole P2 list.

---

## 7. Two decisions worth making first

1. **Adopt `src/components/ui/` inside `features/logistics/`, or accept the divergence deliberately.** Right now the feature reimplements tabs, dialogs, badges, buttons, selects and inputs from scratch. Half of the findings above are downstream of that one choice, and fixing it retires them in bulk.
2. **Decide whether the Board is a desktop-only surface.** If phones only ever need Plan and Timeline plus `/loading`, B1 becomes "hide the Board tab below `md`" instead of building a tap-to-assign sheet — a one-line change rather than a day's work. That is a workflow question, not a design one.
