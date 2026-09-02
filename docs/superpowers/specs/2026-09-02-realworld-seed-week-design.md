# Real-world seed: a week of orders and driver-unavailable scenarios

Date: 2026-09-02. Approved by Alob (approach A, week D-3..D+3, six driver scenarios).

## Problem

"Seed real-world load" creates one snapshot: 150 ready stops on 30 planned runs
today and 40 backlog orders tomorrow. Nothing is in the past, nothing is planned
beyond tomorrow, no driver is ever away. The pages that were built to handle a
real week (Driver roster, Delivery runs history, Leave Management, the owner
dashboard, Dispatch planning for future days) therefore look empty or trivial on
the seeded workspace, and the roster's cover flow (`truck_covers`,
`delivery_runs_default_driver`) is never exercised by demo data.

## Goal

After one click on "Seed real-world load", the workspace looks like a Johor
operation in the middle of a busy week: three finished days behind it, a live
day with mixed run states, three planned days ahead, and a realistic set of
drivers who are away, covered, uncovered, or pending approval.

## Non-goals

- No change to `admin_seed_setup_data` or the demo seed.
- No new pages or UI beyond copy on the console card and the dev sign-in list.
- No leave balance bookkeeping beyond what a direct `leave_requests` insert
  produces. Approved rows get `breakdown` `{carry_forward_used: 0, base_used:
  day_count}` in a follow-up update (the insert trigger recomputes
  `day_count`), so My Leave shows the days as used.

## Week shape

`D` is today in `Asia/Kuala_Lumpur`. Trucks operate every day (the seeded slots
cover all seven weekdays), so order days are calendar days.

| Day | Runs | Stops per truck | State |
|---|---|---|---|
| D-3, D-2, D-1 | `completed`, `driver_id` = regular driver (or cover, see scenario 6) | 4, 5 or 6 by weekday: Fri and Sat 6, Mon 4, else 5 | orders `closed` with `closed_at`, final weights and `total_amount` set, one `delivery_attempts` row `delivered` with `cash_collected` = total, `run_stop_events` arrive/leave pair; every 12th stop `failed` (`shop_closed`, `move_tomorrow`), order left `ready` and re-dated to the next day on the same truck's run |
| D | 27 `planned`, 3 `departed` (JHR-01, JHR-11, JHR-21 with their first 2 stops delivered) | 5 | as today: `ready`, first 2 per run `loaded_at` set, weigh tasks done |
| D+1, D+2, D+3 | none (Dispatch creates them) | 3, 4 or 5 by weekday | per truck-day: `confirmed` orders assigned to the truck (`assignment_source` `auto`, no run) plus one `pending` unassigned order per zone per day |

Failed stops from D-1 land on D as extra `ready` stops on the truck's live run
(so a few runs have 6 stops). Failed stops from D-3 and D-2 land on the next
history day and are delivered there.

Approximate totals: 30 trucks × (15 history + 5 today + 12 future) ≈ 960 orders,
plus 30 pending per future day ≈ 1,050 orders and ≈ 1,600 items. Deterministic
ids via `_dc_uuid(org, 'ro-<day>-<truck>-<stop>')` so re-seeding is stable.

## Driver scenarios

Leave dates must be weekdays: `leave_requests_before_insert` recomputes
`day_count` with `leave_workday_count` (Mon–Fri minus public holidays) and
rejects zero. The seed therefore places leave on **working-day offsets**:
`W(k)` = the k-th weekday after today, with `W(0)` = today if today is a
weekday, else the next Monday; `P(1)` = the last weekday before today.

Two new cover-pool drivers, driver31 and driver32, are created with no regular
truck. `REALWORLD_DRIVER_ACCOUNTS` grows to 32; `truckCode` is `null` for them.

| # | Scenario | Data | What it shows |
|---|---|---|---|
| 1 | Approved leave, nobody covers | driver03 emergency leave `W(1)`..`W(2)`, `approved` | Roster: JHR-03 gap "No driver" on two days; the gaps rail lists free drivers |
| 2 | Approved leave, covered | driver07 emergency leave `W(1)`..`W(3)`, `approved`; `truck_covers` JHR-07 → driver31 on each of those dates | Roster: blue cover cells; when Dispatch creates the run, `delivery_runs_default_driver` picks driver31 |
| 3 | Sick today | driver18 medical leave `W(0)`, `approved` (decided this morning) | If today is a weekday: JHR-18's live run gets `driver_id` null from the default-driver trigger, so Delivery runs and Dispatch show a run with no driver and driver32 is free. On a weekend the leave falls on Monday and today's run keeps driver18 |
| 4 | Pending leave (risk) | driver12 annual leave starting on the first workday on or after `D+7`, two workdays, `pending` | Roster amber "at risk"; Leave Management has one request to decide |
| 5 | Public holiday | `public_holidays` row on `W(4)`, name `Cuti Umum (demo)` | Roster shades the day; `W(4)` is always after the seeded order window (W4 ≥ D+4), so it only shows on the roster |
| 6 | Cover in history | driver22 medical leave `P(1)`, `approved`; `truck_covers` JHR-22 → driver31 on `P(1)`; the completed run on `P(1)` has `driver_id` = driver31 | Run history shows a run driven by a cover driver. `P(1)` is clamped to `D-3`..`D-1` (the days that have runs); after a long weekend or holiday there is no such workday and scenario 6 is skipped |

Scenarios 1 and 2 use **emergency** leave, not annual: `leave_requests_before_insert`
refuses annual leave that starts less than 7 calendar days out
(`leave_min_notice_days`), and the seed cannot bypass a trigger. Scenario 4
keeps annual leave and respects the notice. `W(k)` also skips the org's public
holidays, mirroring `leave_workday_count`, so `day_count` is never zero.
Scenario 2's leave range is a calendar range but covers are written only on
workdays, so the roster shows JHR-07 on leave without cover over the weekend;
that is intended, nobody covers a weekend.

Cover rows respect the roster triggers: driver31 is an active driver-role member
of the org, is not on leave, and is never covered twice on one date (scenarios
2 and 6 are on different dates).

## Approach

**A (chosen):** one migration redefines
`admin_seed_realworld_data(p_organization_id uuid, p_drivers jsonb)`. The
server action creates or finds the 32 driver accounts as it does today, then
passes `{"JHR-01": "<uuid>", …, "pool": ["<uuid31>", "<uuid32>"]}`. Everything
else happens inside the SQL function in one transaction:

1. `admin_clear_org_data` as today, then the seed's own clean-up of what that
   function deliberately keeps: `truck_covers` for the org, `leave_requests`
   for the users in `p_drivers`, `public_holidays` named `Cuti Umum (demo)`.
2. Setup (zones, bays, trucks, slots, customers) unchanged, but each truck's
   `regular_driver_id` is set from `p_drivers` at insert time.
3. Holiday, leave requests, covers (before runs, so the run inserts can read
   them).
4. Runs for D-3..D inserted without `driver_id`, so the existing
   `delivery_runs_default_driver` trigger resolves it: cover for that date if
   any, else the regular driver, else null if that driver has approved leave on
   the date. The trigger is deterministic given steps 2 and 3, and using it
   means the seed exercises the same path Dispatch does.
5. Orders, items, tasks, weight logs, attempts, stop events per the week table.
6. Return the same jsonb summary plus `leave_requests`, `truck_covers`,
   `history_runs`.

The app-side loop that called `dispatch_assign_driver` per run and the
per-truck `regular_driver_id` update are removed; the audit record's `drivers`
is the number of accounts actually mapped (30 trucks + pool).

**B (rejected):** keep the SQL and add history, leave and covers from the server
action through the existing RPCs. Not atomic, about a thousand client-side
inserts, and the RPCs enforce notice rules (annual leave needs seven days)
that a seed should not have to satisfy.

## Files

- `supabase/migrations/20260903000003_realworld_seed_week.sql` — drop the
  one-arg function, create the two-arg function, grants as before.
- `src/features/data-console/lib/accounts.ts` — 32 driver accounts, pool
  drivers have `truckCode: null`; two more Malay names.
- `src/features/data-console/server/actions.ts` — build `p_drivers`, drop the
  assign and regular-driver loops.
- `src/features/data-console/tests/unit/console-accounts.test.ts` — 32
  accounts, 30 with a truck, 2 without.
- `src/messages/en.json`, `src/messages/ms.json` (+ generated
  `en.d.json.ts`) — realworld card copy: "about 1,000 orders across the week
  (3 days done, today live, 3 days planned), 32 drivers, 4 on leave or
  pending".
- Dev sign-in dialog — "Drivers (32)".
- `src/types/database.generated.ts` — regenerate for the new function
  signature.
- `supabase/tests/rls/33_realworld_seed_week.sql` — pgTAP.

## Testing

- pgTAP `33_realworld_seed_week.sql`: seed as owner with two fake driver
  members + two pool members; assert run count per day, JHR-03 has no cover
  and its regular driver has approved leave on `W(1)`, JHR-07's cover on
  `W(1)` is the first pool driver, the `P(1)` run of JHR-22 has the pool
  driver as `driver_id`, today's JHR-18 run has null `driver_id` on a weekday,
  every history order is `closed` with a `delivered` attempt, no order is
  dated on the holiday, re-seeding twice leaves the same counts.
- Vitest: accounts test as above.
- Manual browser check after `npm run db:reset` + seeding from the console as
  admin: `/roster` shows 2 gaps + 1 at-risk + cover cells, `/runs` shows
  completed history and a driverless run, driver3 deck shows today's run,
  driver31 deck shows nothing today (no run) — all on 1440 and 390.

## Decisions

- Week is D-3..D+3 calendar days; leave and holiday snap to weekdays.
- The `dispatch_assign_driver` loop is replaced by in-SQL driver resolution.
- Seed cleans only its own HR rows (seeded drivers' leave, demo holiday, org
  covers), never other members' leave.
- Failed stops re-date to the next day rather than staying stranded.
