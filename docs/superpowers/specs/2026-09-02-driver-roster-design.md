# Driver roster: who drives what, and which truck needs a replacement

Date: 2026-09-02. Design canvas: https://claude.ai/code/artifact/191a3c0c-70da-4aa2-a248-89f75419a680 (concept B chosen; A and C parked on the second canvas page). Each breakpoint at desktop 1440, tablet 834, mobile 390.

## Problem

Leave lives in HR (`leave_requests`), trucks and runs live in Dispatch (`trucks`, `delivery_runs`), and nothing joins them. Today the office finds out a truck has no driver on the morning of the run, when Dispatch tries to assign one. There is no screen that answers, for the next two weeks, "who is driving which truck each day, who is away, and which truck therefore needs a replacement driver?"

Two facts in the current model shape everything below:

- A driver is attached to a **run** (`delivery_runs.driver_id`), never to a truck. Runs are created ad hoc when the first order is assigned (`dispatch_assign_order`), usually the day before or the same day. So future days have no runs and therefore no drivers to show.
- HR already publishes a safe view of approved absences (`leave_whos_away`), but pending requests are HR-only, and the roster planner needs to see them as *risk*.

## Goal

A **Driver roster** page under Fulfillment that shows, per day across a chosen window, every driver's state (driving, on leave, leave pending, covering, free, off) and every truck's coverage, flags each operating day where a truck has no driver, and lets the planner assign a cover driver in one tap. The assignment then becomes the run's driver when Dispatch plans that day.

## Assumptions (made without asking; flag any that are wrong)

1. Each truck has a **regular driver** most days. This is new data (`trucks.regular_driver_id`); without it "gap" cannot be defined. Trucks with no regular driver (spare trucks, or a truck run by rotating cover) are shown as needing a driver on every operating day.
2. A truck's **operating days** come from its existing `delivery_slots` weekdays (a truck with no slot on Sunday is not running Sunday, so it has no gap). Org-wide and per-truck `schedule_blocks` and `public_holidays` also close a day.
3. Drivers have no fixed rest days in the data. V1 treats a driver as available on any day the org operates unless on leave. Per-driver rest days are phase 3.
4. Roles: seller, supervisor, owner, org_admin plan the roster (view + edit). HR sees it read-only so they can judge the impact of a pending request before approving. Drivers do not see it (they have the driver deck and My Leave).
5. Window: default 2 weeks starting Monday of the current week, in the org's `default_time_zone`; week and month views are toggles.
6. One cover driver per truck per day. Split days are out of scope.

## Recommended feature set

V1 (ship first):

- Roster grid for the window: trucks × days, cover pool below, with the cell states in the Screen section.
- "Trucks without driver" count per day and a gaps list for the window, each with the drivers who are free that day.
- Regular driver per truck, editable inline (`Set regular drivers`).
- Assign / clear a cover for a truck on a date.
- Pending leave shown hatched as *at risk*, with the truck it would leave uncovered.
- Public holidays and truck off-days shaded so they never count as gaps.
- Legend, today marker, prev/next/Today, week / 2 weeks / month.
- Assign dialog with ranked drivers (the ranking is v1, not v2).

V2:

- Dispatch reads the roster: when a run is created for (truck, date), `driver_id` defaults to the cover if one exists, else the regular driver. `dispatch_assign_driver` still overrides for the day.
- Delivery runs board shows a "planned driver" chip on planned runs, and a warning when the planned driver has approved leave.
- Ranking bonus for "has driven this truck before" (needs run history per driver).

V3:

- Per-driver rest weekdays (`organization_members.rest_weekdays int[]`), counted as off.
- Notify the planner when HR approves a leave that creates a gap, and warn HR at approval time when no cover exists ("approving leaves JHR-01 without a driver on Fri 4 Sep").
- Driver deck "Tomorrow" card reads the roster instead of "Nothing assigned yet".

## Data model

New in one migration, `20260903000001_driver_roster.sql`:

```sql
alter table trucks add column regular_driver_id uuid references auth.users(id) on delete set null;

create table truck_covers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  truck_id uuid not null references trucks(id) on delete cascade,
  cover_date date not null,
  driver_id uuid not null references auth.users(id) on delete cascade,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (truck_id, cover_date)
);
```

Constraints enforced by trigger, mirroring the leave module's hardening pattern: `driver_id` and `regular_driver_id` must be an active `organization_members` row of the same org with `role = 'driver'`; `truck_id` must belong to `org_id`. RLS: select for any active member of the org who is not a driver (same narrowing pattern as `delivery_runs`); insert/update/delete via `has_permission(org, 'driver_roster', 'edit')`. Grants on the new table (repo gotcha: new tables need explicit grants).

A second safe view `leave_roster` next to `leave_whos_away`: same columns plus `status` (approved or pending only), readable by members holding `driver_roster:view`. Nothing else from `leave_requests` leaks (no justification, attachment, decision note).

## Gap rule (pure model, unit tested)

For each truck T and day D in the window:

```
operating(T, D)  = T.is_active
                 and D not in public_holidays(org)
                 and no schedule_block covers (org-wide or T) on D
                 and T has a delivery_slot on weekday(D)
absent(P, D)     = P has an approved leave_request covering D
pending(P, D)    = P has a pending leave_request covering D
planned(T, D)    = truck_covers(T, D).driver_id
                   ?? (existing delivery_run(T, D).driver_id)
                   ?? T.regular_driver_id
state(T, D)      = not operating           -> off
                   planned is null          -> gap
                   absent(planned, D)       -> gap        (cover who then went on leave)
                   pending(planned, D)      -> risk
                   planned = regular        -> regular
                   otherwise                -> cover
```

Driver cell state: `off` (org not operating), `leave`, `pending`, `cover` (planned on a truck that is not their regular), `driving` (planned on their regular truck), `free`. A driver planned on two trucks the same day is a validation error at assign time.

`buildRoster(input)` in `src/features/logistics/lib/roster-model.ts` takes plain arrays (trucks, members, slots, blocks, holidays, leave rows, covers, runs) and returns `{ days, truckRows, driverRows, gaps, risks, freeByDay }`. Tests in `src/features/logistics/tests/unit/roster-model.test.ts` cover: holiday closes a day, truck without a slot that weekday, regular on leave with and without cover, cover who is themselves on leave, pending leave becomes risk, truck with no regular driver, existing run's driver wins over regular, free list excludes drivers planned elsewhere.

## Server

`src/features/logistics/server/roster-actions.ts`:

- `getDriverRoster(orgSlug, fromDate, days)` — reads trucks (+ regular driver profile), driver members, slots, blocks, holidays, `leave_roster`, `truck_covers`, and `delivery_runs` in range, then returns `buildRoster(...)`. Guard: `requirePermission(org, "driver_roster", "view")`.
- `setRegularDriver(orgSlug, truckId, driverId | null)` — edit guard, revalidates `/roster`.
- `assignCover(orgSlug, truckId, date, driverId, note?)` — upsert on (truck, date). Refuses when the driver has approved leave on that date or is already planned on another truck that day; both are also enforced in the DB trigger. Revalidates `/roster` and `/runs`.
- `clearCover(orgSlug, truckId, date)`.

Error mapping follows the existing `*-message-keys` pattern so the UI toasts i18n copy, not SQL text.

## Page, nav, RBAC, i18n

- Route `src/app/[locale]/(seller)/[organizationSlug]/roster/` — `page.tsx` (guard, today in org tz, initial 14-day fetch) + `roster-client.tsx`.
- Nav: Fulfillment group, after Delivery runs: `{ titleKey: "pages.driverRoster", segment: "roster", resource: "driver_roster" }`.
- RBAC: new resource `driver_roster` in `src/lib/auth/rbac.ts` RESOURCES; DEFAULT_ROLE_GRANTS view+edit for seller, supervisor, owner, org_admin; view for hr. Migration seeds `role_permissions` for system roles the same way `20260901000001_dynamic_rbac_schema.sql` does, and the capability parity pgTAP test gets the new key.
- i18n: `roster` namespace in `en.json` and `ms.json`, plus `dashboard.pages.driverRoster`.
- Realtime: not needed for v1; the page refetches after each write and on window change.

## Screen (concept B · Truck Coverage Board)

Same chrome as every seller page: inset sidebar, h-16 header ("Ayam Norliza / Driver roster · Fulfillment workspace"), Poppins, shadcn buttons and cards, the status oklch hues from `globals.css`.

**Toolbar.** Display-serif title "Truck coverage". Alert pill (Bell icon, red count "N gaps · K at risk", hidden when both are zero, same pattern as the runs AlertBell). Segmented Week / 2 weeks / Month. `‹` Today `›` (Today is filled when the window contains today, like the runs page). Range chip with the calendar icon. Second row: zone filter, "Set regular drivers" (opens a dialog listing trucks with a driver select each), legend on the right.

**Grid.** One row per active truck, `200px` head + one column per day. Head: `JHR-01 · Batu Pahat` and the regular driver (avatar + name), or "No regular driver" in destructive red. Header row: weekday cap, day number (filled circle for today), holiday name in the editorial accent under it. Cell states, in priority order:

| state | look | copy |
|---|---|---|
| off | grey diagonal hatch | none |
| holiday | muted fill | "Holiday" |
| gap | 2px dashed destructive outline, inset | "No driver" |
| risk | amber hatch | "Pend." + "leave" |
| cover | blue soft fill | driver name bold + "cover" |
| regular | quiet | small muted check |

Below the trucks, a muted band "Cover pool · not tied to a truck", then one row per driver with no regular truck: cells are `Free`, `Leave` + short type (AL / MC / EL), `Pend.`, or the truck code bold + "cover". Cells are 11px, single-line with ellipsis, 44px tall. Today's column has a 2px inset ring on every cell. The grid scrolls inside its own container at narrow widths; the page never scrolls sideways.

Clicking a gap cell or a cover cell opens the assign dialog (below). Clicking a regular cell does nothing. Hover shows the full text as `title`.

**Rail (desktop, 300px).** Card: "Next 14 days" cap, a display-serif count "2 trucks need a driver". Then "Gaps": one item per (truck, day) with the truck code, the day, the reason ("Azman · Annual leave (Thu–Fri)") and a row of free drivers as buttons, the first one filled with a plus icon. Then "At risk · leave not yet approved" items in amber, same shape, with "Plan a backup" instead of assign. Footer note: "Covers you assign here become the run's driver when Dispatch plans that day." Gap items are ordered by date; each button is a one-click assign with a confirm toast and undo. The rail's count and list refresh after every write.

**Assign dialog.** Title "Assign cover", subtitle "JHR-01 · Fri 4 Sep", one line of context ("Azman is on annual leave. Who takes the Batu Pahat run?"). Radio list of drivers ranked: free cover-pool drivers first, then drivers whose own truck is not running that day, then everyone else with a warning line ("Driving JHR-04 that day · would leave Segamat uncovered"). Drivers on approved leave that day are excluded. Primary button "Assign {name} to {truck}". For an existing cover the dialog also offers "Clear cover".

**Tablet (834).** Sidebar collapses to the icon rail. Window defaults to one week (7 columns, 150px head). The rail becomes a card docked under the grid: count on the left, "See all" on the right, gap items in a two-column grid with the same assign buttons. Everything else unchanged.

**Mobile (390).** Header is compact (44px trigger, no org name). Three tabs: **Gaps** (default), **Trucks**, **Drivers**. Gaps tab: count headline, a "14 days" range chip, then one card per gap (truck code, "no driver" badge, day, reason, full-width "Assign cover" h-11 button), then an "At risk" section with amber cards and "Plan a backup". Assigning opens a bottom sheet with the same ranked radio list and a full-width confirm. Trucks tab: the grid as a horizontally scrolling 7-day strip, one truck per row. Drivers tab: one card per driver with a 14-day availability sparkline (concept C's mobile card) and a status line.

Empty state (no trucks, or no drivers with the driver role): a card pointing at Delivery setup / Users.

Parked: concepts A (driver-first grid) and C (month timeline). Their mobile ideas already used here: A's date strip is not used; C's driver sparkline card is the Drivers tab.

## Phases

1. **Read-only roster** — migration (regular driver, `leave_roster` view, RBAC seed), model + tests, `getDriverRoster`, page with grid and gaps list, nav, i18n. No cover writes yet; the gaps list says who is free.
2. **Covers** — `truck_covers` table, RLS + pgTAP, `assignCover` / `clearCover` / `setRegularDriver`, assign UI per concept, Dispatch default-driver integration.
3. **Polish** — pending-leave risk to HR at approval, rest weekdays, driver deck tomorrow card, realtime if the office asks for it.

## Testing

Unit: `roster-model.test.ts` (rules above), message-key mapping tests for the actions. pgTAP: RLS on `truck_covers` (driver cannot read, seller can write, hr read-only), trigger rejects a non-driver or cross-org driver, unique (truck, date). e2e: seed one approved leave for driver1 tomorrow, open `/roster` as supervisor, expect the JHR-01 gap, assign driver2 as cover, expect the cell to flip and the gap count to drop. Browser check at 1440, 834 and 390 with the real-world seed (30 trucks) to confirm the grid scrolls inside its own container and the page never scrolls sideways.

## Out of scope

Shift times within a day, split covers, driver pay or overtime, automatic cover assignment, editing leave from this page (HR owns approvals), a driver-facing roster view.

## Decisions taken

Concept B chosen by Alob on 2026-09-02. Assumptions 1–6 stand until he says otherwise: regular driver per truck, `delivery_slots` weekdays as operating days, no per-driver rest days in v1, HR read-only including pending impact, default 2-week window, one cover per truck-day.
