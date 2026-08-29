# Weigh claims — explicit Start gate (supersedes auto-claim on first digit)

**Date:** 2026-08-29
**Status:** approved (chat), implementing
**Amends:** 2026-08-29-weigh-concurrency-design.md (client trigger only; DB/RPC/realtime unchanged)

## Change

The auto-claim-on-first-digit trigger shipped in `99f7f2d` is replaced by an
explicit **Start** step, mirroring loading's Start/Load two-step. Rationale
(user decision): clearer intent beats the extra tap, and a blocked order
should not accept input at all — the numpad disappears so the worker's only
move is to pick another order.

## Behavior

Per current task (the claim unit is still the task/order):

- **Unclaimed (or my claim expired):** the numpad is replaced by a primary
  **Start weighing** button. Tapping it claims the task
  (`claimWeighTask(claim: true)`, optimistic `CLAIM_LOCAL`). On success the
  numpad appears. An expired own claim shows Start again; re-claim refreshes
  the TTL and drafts are preserved.
- **Claimed by me (active):** numpad and keyboard input work exactly as
  today.
- **Claimed by someone else (active):** numpad hidden. Panel shows the amber
  "{name} weighing" chip plus a "pick another order" hint. No input reaches
  the draft. Rail release control stays as the deliberate unblock.
- Physical keyboard: digits/dot/backspace/`P` only act when the current task
  is mine-active. **Enter** = Start when the task is startable (unclaimed /
  expired / mine-expired), otherwise Next as today.
- SwipeDeck (mobile): same three states on the card — Start button in place
  of the numpad, blocked card shows chip + hint, swipe left still skips.
- Everything else stands: `NEXT`/`SKIP`/initial cursor skip blocked tasks,
  realtime sync, `CLAIM_REJECTED` on a lost Start race (toast + advance),
  completion clears the claim, TTL 10 min via `isClaimActive`.

## Model

New pure selector in `weigh-model.ts`:
`isTaskMineActive(state, taskId, nowMs)` — claim exists, `by === viewerId`,
active. `isTaskStartable = !blocked && !mineActive`. No reducer changes —
`CLAIM_LOCAL` / `CLAIM_CLEARED` / `CLAIM_REJECTED` / `SYNC_TASKS` are reused;
the digit-funnel (`dispatchWithClaim`/`maybeClaim`) is removed from
`tasks-client.tsx` in favor of an explicit `startTask(taskId)` callback.

## i18n (en + ms)

- `tasks.startWeighing`: "Start weighing" / "Mula menimbang"
- `tasks.pickAnother`: "Pick another order" / "Pilih pesanan lain"

## Out of scope

- DB, RPCs, realtime, release semantics, loading feature — unchanged.
