# Driver start-run loading gate

**Date:** 2026-08-27
**Problem:** The runs board blocks "Mark departed" while orders are unloaded
("This truck cannot depart yet"), but the driver deck happily shows "Start
delivering" for the same run. The rule lives only in the office UI
(`departureCheck` in `run-board-model.ts`); the database never enforces it.
Worse, `driver_start_run` strips only `status <> 'ready'` orders at depart, so
a weighed-but-never-loaded order *stays on the run* and the driver is sent to
deliver goods that are not on the truck.

## Decision

One gate, both surfaces, enforced in the database.

1. **DB** — `driver_start_run` raises `not_loaded` unless every non-cancelled
   order on the run has `status = 'ready'` **and** `loaded_at is not null`.
   Cancelled orders are excluded from the gate and still released at depart
   (they can never be marked loaded, so gating on them would block the run
   forever). The strip of non-ready orders stays for that cancelled case; for
   everything else the gate makes it unreachable.
2. **Driver deck** — reuses the exact office gate (`departureCheck`). While
   blocked: "Start delivering" is disabled, an amber panel names the
   unloaded/unweighed stops, the whole-run list tags them "Not loaded", and
   the screen refreshes itself every 15 s while the run is still `planned`, so
   it unblocks on its own the moment the loading bay signs the last order off.
3. **Office** — unchanged. The runs board keeps its existing UI gate; the
   dispatch board's depart flow remains the explicit escape hatch that drops
   not-ready orders behind a confirm dialog that names them.

## Rejected

- **Driver confirm-dialog that strips unloaded orders** (mirror of the office
  escape hatch): hands re-planning power to the wrong role; stops silently
  vanishing off a phone screen was the confusion this feature removes.
- **UI-only driver gate**: the same hole this bug came from — any new surface
  (or the office shadowing flow) would reintroduce it. The rule goes in the DB.

## Touch list

- `supabase/migrations/20260827000004_driver_start_run_loading_gate.sql`
- `src/features/orders/server/driver-actions.ts` — map `not_loaded` →
  `errors.drive.run.notLoaded`
- `src/features/orders/lib/driver-run-model.ts` — `DriverStop.loaded`
- `src/features/orders/components/driver-deck.tsx` — blocked panel, disabled
  button, poll-while-planned, "Not loaded" stop tag
- `src/messages/en.json`, `src/messages/ms.json` — new driverDeck + error keys
- `src/features/orders/tests/unit/driver-actions-message-keys.test.ts`,
  `driver-run-model.test.ts`
- `e2e/driver-run.spec.ts` — seed helper now marks the order loaded via the
  suite's service-role pattern; first spec asserts blocked → unblocked
