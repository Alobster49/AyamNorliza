# Weigh concurrency — auto-claims, live queue, weighed-by

**Date:** 2026-08-29
**Status:** approved (chat), spec review pending

## Problem

Several workers weigh at the same time on `/tasks`. The queue is fetched once
server-side (`getTodayTasks`) and never refetched, and every worker's default
cursor points at the first task — so two workers opening the page weigh the
**same order**. `complete_order_task` already locks `for update` and rejects a
non-`pending` task with `task_done`, so the second submit fails at the DB —
but only after worker B spent minutes weighing birds that were already done.
Nothing on screen ever says "A is weighing this order".

Sibling design: `2026-08-29-loading-concurrency-design.md` solves the same
race one step later in the pipeline. This spec deliberately mirrors it —
same TTL, same expired-means-unclaimed rule, same error plumbing — so workers
learn one mental model.

## Design

Two layers, shipped together.

### 1. Live queue + honest server

- **Realtime**: `TasksClient` subscribes to Supabase Realtime
  `postgres_changes` on `public.order_tasks` filtered by `organization_id`
  and refetches the queue (debounced, guarded by an in-flight ref) whenever
  any task changes — completions and claims both arrive this way.
  `order_tasks` is added to the `supabase_realtime` publication; RLS select
  policies already scope events to org members.
- **Refetch merge (`SYNC_TASKS`)**: the reducer rebuilds the queue from fresh
  tasks while preserving local work: drafts and confirmations survive by
  `itemId` for lines still present; the cursor stays on the current line if
  it survives, else moves to the first line of the first *available* task
  (not claimed by an active other). Tasks in `pendingRemovals` (own
  optimistic submits in flight) are never resurrected by a sync.
- **Weighed-by** is out of scope for the queue (completed tasks leave it);
  the loading board already shows who weighed nothing — no UI need here.

### 2. Auto-claim per task (trigger: first digit)

New columns on `public.order_tasks`: `weigh_claimed_by uuid`,
`weigh_claimed_at timestamptz`.

New RPC `claim_weigh_task(p_task uuid, p_claim boolean)`:

- Role guard identical to `complete_order_task`
  (`owner, org_admin, seller, inventory, logistics`); row locked `for update`.
- `p_claim = true` requires: task status `pending`, order status `confirmed`,
  and the claim slot free — free means `weigh_claimed_by` is null, or expired
  (older than **10 minutes**), or already mine (re-claim refreshes the
  timestamp). Otherwise raises `claimed_by_other`.
- `p_claim = false` clears the claim. Any member of the guarded roles may
  release (small trusted team; unblocks a walked-away worker without waiting
  out the TTL).

`complete_order_task` changes (new migration re-creates it wholesale from
`20260810000002`, keeping grants/security intact, per repo convention):

- Rejects when actively claimed by someone else (`claimed_by_other`).
- Clears both claim columns on success.

Claims are advisory locks with TTL, not workflow state: an expired claim is
treated everywhere (SQL and UI) as no claim. `CLAIM_TTL_MS` / `isClaimActive`
move from `loading-model.ts` to a shared `src/lib/claims.ts` and both
features import from there.

### Claim trigger semantics (client)

- The claim unit is the **task** (= order). Typing the first digit (or dot)
  into any line of a task I don't actively hold fires
  `claimWeighTask(taskId, true)` — fire-and-forget, typing is never blocked.
- Moving the cursor within the same task fires nothing. Selecting a task in
  the rail (`GO_TO`) fires nothing — browsing never steals claims.
- On `claimed_by_other` rejection: conflict toast, that task's drafts are
  discarded, its claim is marked in state, and the cursor advances to the
  first available task. The refetch-on-failure keeps a stale screen honest.
- No keep-alive: one claim per task per approach; a task that takes longer
  than 10 minutes simply expires back to the pool (advisory, acceptable).
- Claims are not released on navigation — release paths are: successful
  completion (server clears), TTL expiry, or the explicit release control.

### UI

- **Queue rail / swipe deck**: a task actively claimed by someone else shows
  an amber chip "{name}" (display name via a `people` map returned by
  `getTodayTasks`, same pattern as `getDispatchBoard`). Expired claims render
  as unclaimed. A claimed group exposes a ghost **release** control for
  deliberately clearing a stuck claim.
- **Cursor and advance**: initial cursor = first line of the first available
  task (unless `focusOrderId` points elsewhere — explicit deep links win and
  behave like a deliberate jump). `NEXT` / `SKIP` advance skips lines
  belonging to tasks actively claimed by others; `GO_TO` remains free.
- Mobile `SwipeDeck` shares the reducer, so trigger and skip semantics apply
  unchanged; the chip renders on the card header.

### Data flow

`page.tsx` passes `orgId` and `viewerId` (already available from
`requireOrgRole`) plus the `people` map to `TasksClient`. `weigh-model.ts`
gains per-task claim state (`claims: Record<taskId, { by, at }>`), takes the
viewer id and a `nowMs` in its selectors so activity/mine-ness stays pure and
testable.

`getTodayTasks` select extends with `weigh_claimed_by`, `weigh_claimed_at`
and resolves display names from `profiles` for every claimant on the queue.

## Error handling

New RPC message code mapped in the orders `mapRpcError`:
`claimed_by_other` → conflict `ActionResult` with i18n key
`errors.orders.tasks.claimedByOther` (EN + BM). `task_done` mapping already
exists. Client refetches on any failed claim or complete so a stale screen
self-heals.

## Testing

- `weigh-model.test.ts`: claim fields mapped; expired claim treated as
  unclaimed; initial cursor and `NEXT`/`SKIP` skip actively-claimed tasks;
  `SYNC_TASKS` preserves drafts/confirmed/cursor and drops vanished tasks
  without resurrecting `pendingRemovals`.
- `order-actions.test.ts`: `claimed_by_other` mapping for `completeTask` and
  the new `claimWeighTask` action.
- `claims.ts` unit tests move/extend with `isClaimActive` boundary cases.
- Migration follows repo grant conventions (revoke public / grant
  authenticated on the new RPC; `complete_order_task` grants preserved).

## Out of scope

- Weighed-by display anywhere (loading board / order detail can layer later).
- Presence, station assignment, queue partitioning.
- Any change to the loading claims design or the weigh gate itself.
- Keep-alive/refresh of claims mid-weigh.
