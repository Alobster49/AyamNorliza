# Loading concurrency — claims, live sync, loaded-by

**Date:** 2026-08-29
**Status:** approved (chat), implementing

## Problem

Several workers load trucks at the same time on `/loading`. The screen fetches
once and refetches only after the viewer's own toggle, so worker B never sees
worker A's progress. Worse, the real race is physical: A grabs an order and
walks it to the truck minutes before tapping **Load** — during that window
nothing on any screen says the order is taken, so B can pick the same crates.
`dispatch_set_loaded` happily re-loads an already-loaded order (overwrites
`loaded_by`), so the duplication is silent.

## Design

Two layers, shipped together:

### 1. Live board + honest server

- **Realtime**: `LoadingClient` subscribes to Supabase Realtime
  `postgres_changes` on `public.orders` filtered by `organization_id`, and
  refetches the board (debounced, respecting the existing `inFlightRef`
  guard) whenever any order changes. `orders` is added to the
  `supabase_realtime` publication; RLS select policies already scope events
  to org members.
- **`already_loaded` guard**: `dispatch_set_loaded` refuses
  `p_loaded = true` when `loaded_at` is already set. The loser gets a
  conflict toast and the board refetches to truth.
- **Loaded-by visibility**: `getDispatchBoard` returns a `people` map
  (`user_id → display_name`, from `profiles`) covering every `loaded_by` /
  `loading_claimed_by` on the board. Loaded rows show "by {name}".

### 2. Claim step (per order)

New columns on `public.orders`: `loading_claimed_by uuid`,
`loading_claimed_at timestamptz`.

New RPC `dispatch_claim_loading(p_order uuid, p_claim boolean)`:

- Same role guard as `dispatch_set_loaded`; row locked `for update`.
- `p_claim = true` requires: assigned to a run, run not departed, status
  `ready` (weighed), not loaded, and the claim slot free — free means
  `loading_claimed_by` is null, or expired (older than **10 minutes**), or
  already mine (re-claim refreshes the timestamp). Otherwise raises
  `claimed_by_other`.
- `p_claim = false` clears the claim. Any dispatch-role member may release
  (small trusted team; unblocks a walked-away worker without waiting out
  the TTL).

`dispatch_set_loaded` changes:

- Rejects `p_loaded = true` when actively claimed by someone else
  (`claimed_by_other`).
- Clears both claim columns on every successful write (load and undo).

Claims are advisory locks with TTL, not workflow state: an expired claim is
treated everywhere (SQL and UI) as no claim.

### UI (ManifestRow)

- Unclaimed + weighed: primary button **Start** (claim). The old direct
  **Load** goes away — Start/Load is the two-step.
- Claimed by me: primary **Load** + ghost **cancel** (release).
- Claimed by someone else (active): amber chip "{name} is loading" in the
  status column; action cell shows a ghost **release** so a stuck claim can
  be cleared deliberately. Expired claims render as unclaimed.
- Loaded: unchanged undo, plus "by {name}" under the status badge.
- `nextJobId` skips actively-claimed jobs — the "Next" highlight points at
  work nobody has picked up.

Claim toggles are optimistic like load toggles; on server rejection the row
reverts and the board refetches.

### Data flow

`page.tsx` passes `orgId` and `viewerId` (both already available from
`requireOrgRole`) to `LoadingClient`. `loading-model.ts` gets the viewer id
and a `nowMs` so claim activity/mine-ness stays pure and testable
(`CLAIM_TTL_MS`, `isClaimActive`).

## Error handling

New RPC message codes mapped in `mapRpcError`: `already_loaded`,
`claimed_by_other` → conflict `ActionResult`s with i18n keys
`errors.logistics.dispatch.alreadyLoaded` / `claimedByOther`. Client refetches
on any failed toggle so a stale screen self-heals.

## Testing

- `loading-model.test.ts`: claim fields mapped, expiry treated as unclaimed,
  `nextJobId` skips claimed jobs, loaded-by name resolution.
- `dispatch-actions.test.ts`: new error-code mappings for `setOrderLoaded`
  and `setLoadingClaim`.
- Migration follows repo grant conventions (revoke public / grant
  authenticated on the new RPC).

## Out of scope

- Truck-level claims (per-order chosen; covers swarm-loading and degrades
  fine when one worker owns a truck).
- Presence ("who is viewing"), worker-to-bay territory filters — can layer
  later.
- Any change to the weigh gate or driver start gate.
