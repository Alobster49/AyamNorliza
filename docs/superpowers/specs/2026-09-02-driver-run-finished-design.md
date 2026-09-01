# Driver deck: run finished and day closed

Date: 2026-09-02. Design canvas: https://claude.ai/code/artifact/3edafe65-7443-4c8a-9d9d-f7d040284811 (concepts A and E chosen).

## Problem

After the driver taps **Close run**, `getDriverRun` filters out completed runs, so the drive page falls through to the generic "No run for you today" empty state. A driver who just finished 14 stops reads "the office has not put you on a truck yet". The finished-but-not-closed screen is also a flat block of prose with no sense of what the run earned or what is still on the truck.

Money: the driver never handles cash. The seller settles payment in the office. The driver only sees what the run **earned** (sum of delivered stop totals).

## A. Finished screen (run still `departed`, every stop resolved)

Replaces the `!stop` branch in `driver-deck.tsx`. Same header as today (title, truck, progress bar, My Leave, sign out).

1. **Outcome strip** — green check, "Every stop is done.", "N delivered · K could not be delivered".
2. **Earned today card** — label, "N delivered stops · the office handles payment", amount in display serif (`font-display`).
3. **Before you close** checklist card (only while the run is `departed`):
   - *Still on the truck* — the failed stops, name + weight. Red count on the right. When none: green check, "Nothing left on the truck".
   - *Invoices ready* — "N of N", green. Subline points at the list below.
4. **Close run** primary button (h-12). Hint under it: when K > 0, "The K undelivered stops go back to the office to re-plan." else the existing close hint.
5. **Whole run** list — existing `StopList`, unchanged.

Model: `buildDriverDeck` gains `earned` (delivered stops' `amount`, 2 dp) and `onTruck` (stops whose outcome is `failed`, route order). `cashCollected` stays for the office run board.

## E. Day closed screen (no open run, a completed run today)

New server read `getDriverClosedRunToday(organizationSlug)`: the caller's most recently updated `completed` run whose `run_date` is today in the org's `default_time_zone`. Returns truck label, `closedAt` (`updated_at`), delivered count, earned, and `notDelivered` (distinct orders with a delivery attempt on the run that are not among the run's delivered orders; released orders keep their attempt rows), plus the driver's `display_name`.

Page: when `getDriverRun` returns no run, try the closed run. Found → render `DriverDayClosed`; else the existing empty state.

`DriverDayClosed` layout: sign out top-right, accent rule, display headline "Run closed. Take a break, {name}." (name omitted when blank), "Closed at {time}. The office has your run now.", summary card (Today · truck → "N delivered"; Earned today; Reported as not delivered), a dashed **Tomorrow** card "Nothing assigned yet — this page shows your truck as soon as the office plans it", then My Leave (outline) and Sign out (primary), both h-12.

## Out of scope

Concepts B, C, D. Any change to `driver_finish_run`. Cash anywhere on the driver screens.

## Testing

Unit: `earned` and `onTruck` in `driver-run-model.test.ts`. Typecheck + lint. Browser check on the seeded driver accounts (`driver1@gmail.com`, password `password123`) through finish → close → day closed.
