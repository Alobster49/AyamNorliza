# Weigh Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple workers can weigh simultaneously on `/tasks` without colliding: typing the first digit auto-claims the task, other stations see an amber "{name}" chip live and skip past claimed work, and the queue syncs in realtime.

**Architecture:** Mirrors the shipped loading-concurrency feature (`706a6fd`, spec `docs/superpowers/specs/2026-08-29-loading-concurrency-design.md`): advisory claim columns with a 10-minute TTL on `order_tasks`, a claim RPC, a hardened `complete_order_task`, Supabase Realtime refetch, and pure-model claim state. Spec: `docs/superpowers/specs/2026-08-29-weigh-concurrency-design.md`.

**Tech Stack:** Next.js server actions, Supabase (plpgsql RPCs, Realtime `postgres_changes`), vitest, next-intl.

## Global Constraints

- Claim TTL is exactly **10 minutes**; an expired claim is treated as no claim everywhere (SQL and UI).
- Follow repo grant conventions: `revoke all ... from public; grant execute ... to authenticated;` on every new/re-created RPC.
- All i18n strings land in both `src/messages/en.json` and `src/messages/ms.json`.
- Migrations re-create functions wholesale (copy the full body, never patch fragments), per repo convention.
- Tests: `npx vitest run <path>`. Never run `git checkout -- <path>` in this tree.

---

### Task 1: Migration — claim columns, `claim_weigh_task`, hardened `complete_order_task`, realtime

**Files:**
- Create: `supabase/migrations/20260829000003_weigh_claims.sql`

**Interfaces:**
- Produces: columns `public.order_tasks.weigh_claimed_by uuid`, `weigh_claimed_at timestamptz`; RPC `public.claim_weigh_task(p_task uuid, p_claim boolean)` raising `not_found | forbidden | task_done | invalid_status | claimed_by_other`; `public.complete_order_task` additionally raising `claimed_by_other` and clearing both claim columns on success; `order_tasks` in the `supabase_realtime` publication.

- [ ] **Step 1: Write the migration**

The `complete_order_task` body below is the full body from `supabase/migrations/20260810000002_order_pipeline_functions.sql` with three additions marked `-- NEW`. Copy the original function from that file verbatim, then apply exactly those three edits (do not retype the whole body from this plan — the original is the source of truth for the untouched parts).

```sql
-- Weigh claims: several workers weigh at once on /tasks, and the only
-- signal a task was taken used to be its completion — minutes after the
-- worker started putting birds on the scale. Every station's default
-- cursor also pointed at the same first task, so collisions were the rule,
-- not the exception. complete_order_task already rejects the second submit
-- (task_done, row locked for update), but only after the loser weighed the
-- whole order.
--
-- Three changes, mirroring 20260829000002_loading_claims.sql:
--  * order_tasks grows weigh_claimed_by/weigh_claimed_at — an advisory
--    "worker X is weighing this now" lock with a 10-minute TTL. An expired
--    claim counts as no claim everywhere.
--  * claim_weigh_task(p_task, p_claim) takes or releases the claim
--    atomically (row locked for update; loser gets claimed_by_other).
--    Release is open to any staff role so a walked-away worker's claim can
--    be cleared without waiting out the TTL.
--  * complete_order_task refuses a task actively claimed by someone else
--    (claimed_by_other) and clears the claim on success.
--
-- order_tasks also joins the supabase_realtime publication so open weigh
-- screens hear each other's claims and completions; RLS select policies
-- already scope the events to org members.

begin;

alter table public.order_tasks
  add column if not exists weigh_claimed_by uuid references auth.users (id) on delete set null,
  add column if not exists weigh_claimed_at timestamptz;

comment on column public.order_tasks.weigh_claimed_by is
  'Advisory weigh lock: the worker currently weighing this task. Expires 10 minutes after weigh_claimed_at.';

create or replace function public.claim_weigh_task(p_task uuid, p_claim boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_task_status public.order_task_status;
  v_order_status public.order_status;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
begin
  select ot.organization_id, ot.status, o.status, ot.weigh_claimed_by, ot.weigh_claimed_at
  into v_org, v_task_status, v_order_status, v_claimed_by, v_claimed_at
  from public.order_tasks ot
  join public.orders o on o.id = ot.order_id
  where ot.id = p_task
  for update of ot;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'inventory', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not p_claim then
    -- Release is deliberately open to any staff role, not just the
    -- claimer: it is how a stuck claim gets cleared before the TTL runs out.
    update public.order_tasks
    set weigh_claimed_by = null, weigh_claimed_at = null
    where id = p_task;
    return;
  end if;

  if v_task_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'task_done';
  end if;

  if v_order_status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  -- Free means: never claimed, claim expired, or already mine (re-claim
  -- refreshes the timestamp).
  if v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  update public.order_tasks
  set weigh_claimed_by = auth.uid(), weigh_claimed_at = now()
  where id = p_task;
end;
$$;

revoke all on function public.claim_weigh_task(uuid, boolean) from public;
grant execute on function public.claim_weigh_task(uuid, boolean) to authenticated;

-- complete_order_task: full body copied from
-- 20260810000002_order_pipeline_functions.sql with three additions:
--  (a) declare v_claimed_by uuid; v_claimed_at timestamptz;
--  (b) select + guard: refuse when actively claimed by someone else;
--  (c) clear both claim columns in the task-completion update.
create or replace function public.complete_order_task(p_task uuid, p_weights jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- ... copy the entire original body, then:
--
-- (a) In the declare block, add:
--   v_claimed_by uuid;
--   v_claimed_at timestamptz;
--
-- (b) Change the opening select to also read the claim columns:
--   select ot.organization_id, ot.order_id, ot.status, o.status,
--          ot.weigh_claimed_by, ot.weigh_claimed_at
--     into v_org, v_order_id, v_task_status, v_order_status,
--          v_claimed_by, v_claimed_at
--   ...
-- and immediately after the `invalid_status` order-status guard, add:
--   if v_claimed_by is not null
--      and v_claimed_by <> auth.uid()
--      and v_claimed_at > now() - interval '10 minutes' then
--     raise exception using errcode = 'P0001', message = 'claimed_by_other';
--   end if;
--
-- (c) In the final `update public.order_tasks set status = 'done', ...`
-- statement, also set:
--   weigh_claimed_by = null,
--   weigh_claimed_at = null,
$$;

revoke all on function public.complete_order_task(uuid, jsonb) from public;
grant execute on function public.complete_order_task(uuid, jsonb) to authenticated;

-- Live weigh queue: guarded — db reset replays this after the loading
-- migration, and a table can join a publication only once.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_tasks'
  ) then
    alter publication supabase_realtime add table public.order_tasks;
  end if;
end;
$$;

commit;
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:reset`
Expected: all migrations apply cleanly, including `20260829000003_weigh_claims.sql`, no errors. Then re-seed via the data console (Seed demo data) for manual QA later.

- [ ] **Step 3: Sanity-check the RPC exists**

Run: `psql "$(npx supabase status --output json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['DB_URL'])")" -c "\df public.claim_weigh_task" || npx supabase db diff --schema public | head -5`
Expected: `claim_weigh_task | uuid, boolean` listed (or an empty diff — migration is the source of truth).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260829000003_weigh_claims.sql
git commit -m "feat(db): weigh claims — advisory lock on order_tasks + hardened complete_order_task"
```

---

### Task 2: Shared claims helper `src/lib/claims.ts`

**Files:**
- Create: `src/lib/claims.ts`
- Create: `src/lib/__tests__/claims.test.ts` (mirror the repo's nearest test-location convention — if `src/lib` has no `__tests__` dir, place at `src/features/orders/tests/unit/claims.test.ts`)
- Modify: `src/features/logistics/lib/loading-model.ts` (lines ~23–28: delete the local definitions, import from `@/lib/claims`, keep re-exporting both names so existing importers/tests don't break)

**Interfaces:**
- Produces: `CLAIM_TTL_MS: number` (600000), `isClaimActive(claimedAt: string | null, nowMs: number): boolean`. Both features import from `@/lib/claims`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { CLAIM_TTL_MS, isClaimActive } from "@/lib/claims";

describe("isClaimActive", () => {
  const now = Date.parse("2026-08-29T08:00:00.000Z");

  it("is false for null", () => {
    expect(isClaimActive(null, now)).toBe(false);
  });

  it("is true just inside the TTL", () => {
    const at = new Date(now - CLAIM_TTL_MS + 1000).toISOString();
    expect(isClaimActive(at, now)).toBe(true);
  });

  it("is false exactly at the TTL boundary", () => {
    const at = new Date(now - CLAIM_TTL_MS).toISOString();
    expect(isClaimActive(at, now)).toBe(false);
  });

  it("is false for garbage timestamps", () => {
    expect(isClaimActive("not-a-date", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/claims.test.ts`
Expected: FAIL — cannot resolve `@/lib/claims`.

- [ ] **Step 3: Create `src/lib/claims.ts` by moving the code**

Cut lines ~23–28 of `src/features/logistics/lib/loading-model.ts` (the `CLAIM_TTL_MS` const and `isClaimActive` function, with their comments) into:

```ts
/**
 * Advisory-claim expiry shared by the loading board (orders.loading_claimed_*)
 * and the weigh queue (order_tasks.weigh_claimed_*). A claim is an advisory
 * lock with a TTL, not workflow state: expired means unclaimed everywhere.
 */
export const CLAIM_TTL_MS = 10 * 60 * 1000;

export function isClaimActive(claimedAt: string | null, nowMs: number): boolean {
  if (claimedAt === null) return false;
  const at = Date.parse(claimedAt);
  return Number.isFinite(at) && nowMs - at < CLAIM_TTL_MS;
}
```

In `loading-model.ts`, replace the removed block with:

```ts
import { CLAIM_TTL_MS, isClaimActive } from "@/lib/claims";

export { CLAIM_TTL_MS, isClaimActive };
```

- [ ] **Step 4: Run the new test and the loading-model suite**

Run: `npx vitest run src/lib/__tests__/claims.test.ts src/features/logistics/tests/unit/loading-model.test.ts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/claims.ts src/lib/__tests__/claims.test.ts src/features/logistics/lib/loading-model.ts
git commit -m "refactor: extract shared claim-TTL helper to src/lib/claims"
```

---

### Task 3: Types, `getTodayTasks` people map, error mapping, `claimWeighTask` action

**Files:**
- Modify: `src/features/orders/types.ts:208-220` (`OrderTask`), plus add `TodayTasksData` and `ClaimWeighTaskSchema` next to `CompleteTaskSchema`
- Modify: `src/features/orders/lib/rpc-errors.ts` (add `claimed_by_other` case)
- Modify: `src/features/orders/server/order-actions.ts` (`getTodayTasks`, `completeTask`, new `claimWeighTask`, new `taskMessageKey`)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`errors.orders.tasks.*`)
- Test: `src/features/orders/tests/unit/order-actions.test.ts` (extend, following its existing supabase-mock pattern)

**Interfaces:**
- Consumes: `claim_weigh_task` RPC (Task 1).
- Produces:
  - `OrderTask` gains `weigh_claimed_by: string | null; weigh_claimed_at: string | null;`
  - `export type TodayTasksData = { tasks: TaskWithOrder[]; people: Record<string, string> };`
  - `getTodayTasks(organizationSlug: string): Promise<ActionResult<TodayTasksData>>` (return shape changes — Task 6 updates the callers)
  - `export async function claimWeighTask(rawInput: unknown): Promise<ActionResult>` with input `{ organizationSlug: string; taskId: string (uuid); claim: boolean }`
  - `mapRpcError("claimed_by_other")` → `{ code: "conflict", message: "Another worker is weighing that order right now." }`
  - `completeTask` and `claimWeighTask` failures carry `messageKey: taskMessageKey(raw)` → `errors.orders.tasks.{forbidden|taskDone|invalidStatus|weightsIncomplete|invalidWeight|claimedByOther|internal}`

- [ ] **Step 1: Write the failing tests**

Extend `order-actions.test.ts` following its existing mock pattern (read the file first; reuse its supabase client mock). New cases:

```ts
describe("claimWeighTask", () => {
  it("calls claim_weigh_task and returns ok", async () => {
    // arrange rpc mock to resolve { error: null }
    const result = await claimWeighTask({
      organizationSlug: "org",
      taskId: "11111111-1111-4111-8111-111111111111",
      claim: true,
    });
    expect(result.ok).toBe(true);
    // assert rpc called with { p_task: ..., p_claim: true }
  });

  it("maps claimed_by_other to a conflict with the tasks messageKey", async () => {
    // arrange rpc mock to resolve { error: { message: "claimed_by_other" } }
    const result = await claimWeighTask({
      organizationSlug: "org",
      taskId: "11111111-1111-4111-8111-111111111111",
      claim: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.messageKey).toBe("errors.orders.tasks.claimedByOther");
    }
  });

  it("rejects invalid input", async () => {
    const result = await claimWeighTask({ organizationSlug: "org", taskId: "nope", claim: true });
    expect(result.ok).toBe(false);
  });
});

describe("completeTask claim conflict", () => {
  it("maps claimed_by_other with messageKey", async () => {
    // arrange rpc mock error { message: "claimed_by_other" }
    // call completeTask with a valid payload (copy an existing passing fixture)
    // expect code "conflict" and messageKey "errors.orders.tasks.claimedByOther"
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/orders/tests/unit/order-actions.test.ts`
Expected: FAIL — `claimWeighTask` not exported; missing messageKey.

- [ ] **Step 3: Implement**

`types.ts` — extend `OrderTask`:

```ts
export type OrderTask = {
  id: string;
  organization_id: string;
  order_id: string;
  type: "allocate_weigh";
  assigned_to: string | null;
  status: "pending" | "done";
  done_by: string | null;
  done_at: string | null;
  weigh_claimed_by: string | null;
  weigh_claimed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};
```

Next to `TaskWithOrder`:

```ts
export type TodayTasksData = { tasks: TaskWithOrder[]; people: Record<string, string> };
```

Next to `CompleteTaskSchema`:

```ts
export const ClaimWeighTaskSchema = z.object({
  organizationSlug: z.string().min(1),
  taskId: z.string().uuid(),
  claim: z.boolean(),
});
```

`rpc-errors.ts` — add before `default`:

```ts
    case "claimed_by_other":
      return { code: "conflict", message: "Another worker is weighing that order right now." };
```

`order-actions.ts` — add near `closeMessageKey`:

```ts
/** See `createMessageKey` — same rationale, the weigh-task RPCs' own codes. */
function taskMessageKey(rawMessage: string): string {
  switch (rawMessage) {
    case "forbidden":
      return "errors.orders.tasks.forbidden";
    case "task_done":
      return "errors.orders.tasks.taskDone";
    case "invalid_status":
      return "errors.orders.tasks.invalidStatus";
    case "weights_incomplete":
      return "errors.orders.tasks.weightsIncomplete";
    case "invalid_weight":
      return "errors.orders.tasks.invalidWeight";
    case "claimed_by_other":
      return "errors.orders.tasks.claimedByOther";
    default:
      return "errors.orders.tasks.internal";
  }
}
```

`getTodayTasks` — after the existing query, resolve claimant names and return the new shape (`select("*")` already picks up the new columns):

```ts
  const tasks = (data ?? []) as TaskWithOrder[];

  // Names for whoever is claiming a task, so other stations can say which
  // worker is weighing which order (same pattern as getDispatchBoard).
  const personIds = Array.from(
    new Set(tasks.map((t) => t.weigh_claimed_by).filter((id): id is string => id !== null)),
  );
  const people: Record<string, string> = {};
  if (personIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", personIds);
    for (const profile of profiles ?? []) {
      if (profile.display_name) people[profile.user_id] = profile.display_name;
    }
  }

  return ok({ tasks, people });
```

Change its return type to `Promise<ActionResult<TodayTasksData>>`.

`completeTask` — replace the error return with:

```ts
  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message, undefined, taskMessageKey(error.message));
  }
```

New action, after `completeTask`:

```ts
export async function claimWeighTask(rawInput: unknown): Promise<ActionResult> {
  const parsed = ClaimWeighTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid claim input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const guard = await guardRoles(input.organizationSlug, STAFF_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("claim_weigh_task", {
    p_task: input.taskId,
    p_claim: input.claim,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message, undefined, taskMessageKey(error.message));
  }

  revalidatePath(`/${input.organizationSlug}/tasks`);
  return ok(undefined);
}
```

(Import `ClaimWeighTaskSchema` and `TodayTasksData` from `../types`.)

`en.json` — under `errors.orders`, add sibling of `close`:

```json
"tasks": {
  "forbidden": "You do not have permission to do that.",
  "taskDone": "This task is already done.",
  "invalidStatus": "This order is not in the right status for that action.",
  "weightsIncomplete": "Every line needs a warehouse weight before you can finish this task.",
  "invalidWeight": "Weight must be greater than zero.",
  "claimedByOther": "Another worker is weighing that order right now.",
  "internal": "Something went wrong. Please try again."
}
```

`ms.json` — same keys, translated in the file's existing register (check neighbouring `errors.orders.close.*` for tone):

```json
"tasks": {
  "forbidden": "Anda tidak mempunyai kebenaran untuk berbuat demikian.",
  "taskDone": "Tugasan ini sudah selesai.",
  "invalidStatus": "Pesanan ini tidak berada dalam status yang betul untuk tindakan itu.",
  "weightsIncomplete": "Setiap baris perlukan berat gudang sebelum tugasan ini boleh diselesaikan.",
  "invalidWeight": "Berat mesti lebih daripada sifar.",
  "claimedByOther": "Pekerja lain sedang menimbang pesanan itu sekarang.",
  "internal": "Sesuatu tidak kena. Sila cuba lagi."
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/orders/tests/unit/order-actions.test.ts src/features/orders/tests/unit/order-actions-message-keys.test.ts`
Expected: PASS. (`getTodayTasks` callers now have a type error — that is Task 6's job; `npx tsc --noEmit` is expected to fail until Task 6 and that is fine at this commit. If the repo's pre-commit hook runs typecheck, update `page.tsx`/`tasks-client.tsx` minimally here instead: destructure `result.data.tasks` and drop `people` on the floor.)

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/types.ts src/features/orders/lib/rpc-errors.ts src/features/orders/server/order-actions.ts src/messages/en.json src/messages/ms.json src/features/orders/tests/unit/order-actions.test.ts
git commit -m "feat(orders): claimWeighTask action, people map on getTodayTasks, tasks error keys"
```

---

### Task 4: Weigh-model claim state — blocking, skip, sync, claim actions

**Files:**
- Modify: `src/features/orders/lib/weigh-model.ts`
- Test: `src/features/orders/tests/unit/weigh-model.test.ts` (extend; update existing `createWeighState` call sites in the test to the new signature)

**Interfaces:**
- Consumes: `isClaimActive` from `@/lib/claims`; `TaskWithOrder` with claim columns (Task 3).
- Produces (Task 5 relies on these exact names):
  - `export type TaskClaim = { by: string; at: string };`
  - `WeighState` gains `claims: Record<string, TaskClaim>; viewerId: string | null;`
  - `createWeighState(tasks, opts: { viewerId?: string | null; focusOrderId?: string; nowMs?: number }): WeighState` — initial cursor = first line of the first non-blocked task unless `focusOrderId` matches (deep links win even into a blocked task)
  - `isTaskBlocked(state: WeighState, taskId: string, nowMs: number): boolean` — true iff actively claimed (TTL) by someone other than `viewerId`
  - `nextIncompleteIndex(state, from, nowMs)` skips lines of blocked tasks
  - Actions `NEXT` and `SKIP` gain `nowMs: number`; new actions:
    - `{ type: "SYNC_TASKS"; tasks: TaskWithOrder[]; nowMs: number }`
    - `{ type: "CLAIM_LOCAL"; taskId: string; by: string; at: string }`
    - `{ type: "CLAIM_CLEARED"; taskId: string }`
    - `{ type: "CLAIM_REJECTED"; taskId: string; nowMs: number }`

- [ ] **Step 1: Write the failing tests**

Add to `weigh-model.test.ts` (reuse its existing task-fixture builder; extend the fixture so tasks carry `weigh_claimed_by: null, weigh_claimed_at: null` by default):

```ts
const NOW = Date.parse("2026-08-29T08:00:00.000Z");
const ACTIVE_AT = new Date(NOW - 60_000).toISOString();
const EXPIRED_AT = new Date(NOW - CLAIM_TTL_MS - 1).toISOString();

describe("claims", () => {
  it("maps claim fields into state and marks other-active tasks blocked", () => {
    const tasks = [
      makeTask("t1", { weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT }),
      makeTask("t2"),
    ];
    const state = createWeighState(tasks, { viewerId: "me", nowMs: NOW });
    expect(state.claims["t1"]).toEqual({ by: "worker-a", at: ACTIVE_AT });
    expect(isTaskBlocked(state, "t1", NOW)).toBe(true);
    expect(isTaskBlocked(state, "t2", NOW)).toBe(false);
  });

  it("treats an expired claim as unclaimed", () => {
    const tasks = [makeTask("t1", { weigh_claimed_by: "worker-a", weigh_claimed_at: EXPIRED_AT })];
    const state = createWeighState(tasks, { viewerId: "me", nowMs: NOW });
    expect(isTaskBlocked(state, "t1", NOW)).toBe(false);
  });

  it("my own claim never blocks me", () => {
    const tasks = [makeTask("t1", { weigh_claimed_by: "me", weigh_claimed_at: ACTIVE_AT })];
    const state = createWeighState(tasks, { viewerId: "me", nowMs: NOW });
    expect(isTaskBlocked(state, "t1", NOW)).toBe(false);
  });

  it("initial cursor lands on the first non-blocked task", () => {
    const tasks = [
      makeTask("t1", { weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT }),
      makeTask("t2"),
    ];
    const state = createWeighState(tasks, { viewerId: "me", nowMs: NOW });
    expect(state.queue[state.cursor]?.taskId).toBe("t2");
  });

  it("focusOrderId deep link wins even into a blocked task", () => {
    const tasks = [
      makeTask("t1", { weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT }),
      makeTask("t2"),
    ];
    const state = createWeighState(tasks, {
      viewerId: "me",
      nowMs: NOW,
      focusOrderId: orderIdOf("t1"),
    });
    expect(state.queue[state.cursor]?.taskId).toBe("t1");
  });

  it("NEXT skips lines of blocked tasks", () => {
    // t1 unblocked (1 line), t2 blocked, t3 unblocked
    // cursor on t1's line; NEXT with valid draft must land on t3's line
  });

  it("CLAIM_LOCAL sets, CLAIM_CLEARED removes", () => {
    // dispatch CLAIM_LOCAL then expect claims[taskId]; CLAIM_CLEARED then expect undefined
  });

  it("CLAIM_REJECTED discards the task's drafts and advances off it", () => {
    // type a digit into t1's line, dispatch CLAIM_REJECTED { taskId: "t1", nowMs: NOW }
    // expect drafts for t1's items reset to empty, confirmations gone,
    // and cursor on the next non-blocked task
  });
});

describe("SYNC_TASKS", () => {
  it("preserves drafts, confirmations and cursor for surviving lines", () => {
    // build state from [t1, t2]; type "5" into t1's first line; confirm nothing
    // sync with fresh [t1, t2] where t2 now carries an active other-claim
    // expect draft "5" kept, cursor unchanged, claims["t2"] set
  });

  it("drops vanished tasks and moves a stranded cursor to the first available task", () => {
    // cursor on t1; sync with fresh [t2] (t1 completed elsewhere)
    // expect no t1 lines, cursor on t2's first line
  });

  it("does not resurrect tasks in pendingRemovals", () => {
    // OPTIMISTIC_COMPLETE t1, then SYNC_TASKS with fresh data still containing t1
    // expect t1 absent from queue (its snapshot stays in pendingRemovals for RESTORE_TASK)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/orders/tests/unit/weigh-model.test.ts`
Expected: FAIL — new exports/actions missing.

- [ ] **Step 3: Implement in `weigh-model.ts`**

```ts
import { isClaimActive } from "@/lib/claims";
import type { OrderItemMode, TaskWithOrder } from "../types";

export type TaskClaim = { by: string; at: string };
```

State and options:

```ts
export type WeighState = {
  queue: WeighLine[];
  cursor: number;
  drafts: Record<string, LineDraft>;
  confirmed: Record<string, true>;
  entryTarget: EntryTarget;
  pendingRemovals: Record<string, { removedLines: WeighLine[]; insertAt: number }>;
  /** Active-or-not is decided at read time via isTaskBlocked — raw claim rows live here. */
  claims: Record<string, TaskClaim>;
  viewerId: string | null;
};

export type CreateWeighStateOptions = {
  viewerId?: string | null;
  focusOrderId?: string;
  nowMs?: number;
};

function claimsFromTasks(tasks: TaskWithOrder[]): Record<string, TaskClaim> {
  const claims: Record<string, TaskClaim> = {};
  for (const task of tasks) {
    if (task.weigh_claimed_by !== null && task.weigh_claimed_at !== null) {
      claims[task.id] = { by: task.weigh_claimed_by, at: task.weigh_claimed_at };
    }
  }
  return claims;
}

/** Actively claimed (within TTL) by someone other than the viewer. */
export function isTaskBlocked(state: WeighState, taskId: string, nowMs: number): boolean {
  const claim = state.claims[taskId];
  if (!claim) return false;
  if (claim.by === state.viewerId) return false;
  return isClaimActive(claim.at, nowMs);
}

function firstAvailableIndex(state: WeighState, nowMs: number): number {
  const index = state.queue.findIndex((line) => !isTaskBlocked(state, line.taskId, nowMs));
  return index === -1 ? 0 : index;
}

export function createWeighState(
  tasks: TaskWithOrder[],
  { viewerId = null, focusOrderId, nowMs = 0 }: CreateWeighStateOptions = {},
): WeighState {
  const queue = buildLineQueue(tasks);
  const base: WeighState = {
    queue,
    cursor: 0,
    drafts: Object.fromEntries(queue.map((line) => [line.itemId, { ...EMPTY_DRAFT }])),
    confirmed: {},
    entryTarget: "weight",
    pendingRemovals: {},
    claims: claimsFromTasks(tasks),
    viewerId,
  };
  const focused = focusOrderId ? indexOfOrder(queue, focusOrderId) : -1;
  return { ...base, cursor: focused === -1 ? firstAvailableIndex(base, nowMs) : focused };
}
```

`nextIncompleteIndex` gains `nowMs` and skips blocked tasks:

```ts
export function nextIncompleteIndex(state: WeighState, from: number, nowMs: number): number | null {
  const { queue } = state;
  if (queue.length === 0) return null;
  for (let step = 1; step <= queue.length; step++) {
    const index = (from + step) % queue.length;
    const line = queue[index];
    if (line && !state.confirmed[line.itemId] && !isTaskBlocked(state, line.taskId, nowMs)) {
      return index;
    }
  }
  return null;
}
```

`advance` takes `nowMs` and threads it through; `NEXT` and `SKIP` actions gain `nowMs`:

```ts
export type WeighAction =
  | { type: "DIGIT"; digit: string }
  | { type: "DOT" }
  | { type: "BACKSPACE" }
  | { type: "TOGGLE_TARGET" }
  | { type: "NEXT"; nowMs: number }
  | { type: "SKIP"; nowMs: number }
  | { type: "UNDO" }
  | { type: "GO_TO"; index: number }
  | { type: "OPTIMISTIC_COMPLETE"; taskId: string }
  | { type: "COMPLETE_SUCCESS"; taskId: string }
  | { type: "RESTORE_TASK"; taskId: string }
  | { type: "SYNC_TASKS"; tasks: TaskWithOrder[]; nowMs: number }
  | { type: "CLAIM_LOCAL"; taskId: string; by: string; at: string }
  | { type: "CLAIM_CLEARED"; taskId: string }
  | { type: "CLAIM_REJECTED"; taskId: string; nowMs: number };
```

```ts
function advance(state: WeighState, nowMs: number): WeighState {
  const next = nextIncompleteIndex(state, state.cursor, nowMs);
  return { ...state, cursor: next ?? state.cursor, entryTarget: "weight" };
}
```

New reducer cases (existing `NEXT`/`SKIP` cases pass `action.nowMs` into `advance`):

```ts
    case "SYNC_TASKS": {
      // Rebuild from server truth, but never resurrect a task we are
      // mid-submitting (its snapshot lives in pendingRemovals for RESTORE_TASK).
      const fresh = buildLineQueue(action.tasks).filter(
        (line) => !state.pendingRemovals[line.taskId],
      );
      const drafts: Record<string, LineDraft> = Object.fromEntries(
        fresh.map((line) => [line.itemId, state.drafts[line.itemId] ?? { ...EMPTY_DRAFT }]),
      );
      const confirmed: Record<string, true> = {};
      for (const line of fresh) {
        if (state.confirmed[line.itemId]) confirmed[line.itemId] = true;
      }
      const claims = claimsFromTasks(action.tasks);
      const currentItemId = state.queue[state.cursor]?.itemId;
      const surviving = fresh.findIndex((line) => line.itemId === currentItemId);
      const next: WeighState = { ...state, queue: fresh, drafts, confirmed, claims };
      return {
        ...next,
        cursor: surviving !== -1 ? surviving : firstAvailableIndex(next, action.nowMs),
      };
    }
    case "CLAIM_LOCAL":
      return {
        ...state,
        claims: { ...state.claims, [action.taskId]: { by: action.by, at: action.at } },
      };
    case "CLAIM_CLEARED": {
      const claims = { ...state.claims };
      delete claims[action.taskId];
      return { ...state, claims };
    }
    case "CLAIM_REJECTED": {
      // Someone else holds the task: throw away what was typed into it and
      // move on. The refetch that follows delivers the true claimant.
      const itemIds = state.queue
        .filter((line) => line.taskId === action.taskId)
        .map((line) => line.itemId);
      const drafts = { ...state.drafts };
      for (const id of itemIds) drafts[id] = { ...EMPTY_DRAFT };
      const claims = { ...state.claims };
      delete claims[action.taskId];
      const next = { ...state, drafts, confirmed: unconfirm(state.confirmed, itemIds), claims };
      return advance(next, action.nowMs);
    }
```

- [ ] **Step 4: Run the model tests, then the whole orders suite (call sites of NEXT/SKIP/createWeighState in existing tests need the new signature)**

Run: `npx vitest run src/features/orders/tests/unit/weigh-model.test.ts && npx vitest run src/features/orders/tests/unit`
Expected: PASS after updating existing test call sites (`createWeighState(tasks, focus)` → `createWeighState(tasks, { focusOrderId: focus })`; `{ type: "NEXT" }` → `{ type: "NEXT", nowMs: NOW }`).

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/lib/weigh-model.ts src/features/orders/tests/unit/weigh-model.test.ts
git commit -m "feat(orders): weigh-model claim state — blocked tasks, skip, realtime sync merge"
```

---

### Task 5: Client wiring — auto-claim on first digit, realtime queue, page props

**Files:**
- Modify: `src/app/[locale]/(seller)/[organizationSlug]/tasks/page.tsx`
- Modify: `src/app/[locale]/(seller)/[organizationSlug]/tasks/tasks-client.tsx`

**Interfaces:**
- Consumes: `claimWeighTask`, `getTodayTasks` → `TodayTasksData` (Task 3); model actions (Task 4); `createSupabaseBrowserClient` from `@/lib/supabase/client`.
- Produces: `TasksClientProps` gains `orgId: string; viewerId: string; initialPeople: Record<string, string>` and `initialTasks: TaskWithOrder[]` stays. Exposes `people` and a `release(taskId)` callback + `nowMs` to the UI components (Task 6 consumes these prop names on `WeighStation`/`SwipeDeck`).

- [ ] **Step 1: Update `page.tsx`**

`requireOrgRole` already returns the context — capture it:

```ts
  let ctx;
  try {
    ctx = await requireOrgRole(organizationSlug, STAFF_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const result = await getTodayTasks(organizationSlug);

  return (
    <TasksClient
      organizationSlug={organizationSlug}
      orgId={ctx.orgId}
      viewerId={ctx.userId}
      initialTasks={result.ok ? result.data.tasks : []}
      initialPeople={result.ok ? result.data.people : {}}
      focusOrderId={focusOrderId}
    />
  );
```

(`redirect` from `@/i18n/navigation` throws, so `ctx` is always set past the try — add a `if (!ctx) return null;` guard only if the compiler demands it.)

- [ ] **Step 2: Rewire `tasks-client.tsx`**

Full changes, in order:

```tsx
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { claimWeighTask, completeTask, getTodayTasks } from "@/features/orders/server/order-actions";
import type { TaskWithOrder } from "@/features/orders/types";
import {
  buildCompletePayload,
  createWeighState,
  firstReadyUnsubmittedTaskId,
  isTaskBlocked,
  weighReducer,
  type WeighAction,
} from "@/features/orders/lib/weigh-model";
import { WeighStation } from "@/features/orders/components/weigh-station";
import { SwipeDeck } from "@/features/orders/components/swipe-deck";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";

type TasksClientProps = {
  organizationSlug: string;
  orgId: string;
  viewerId: string;
  initialTasks: TaskWithOrder[];
  initialPeople: Record<string, string>;
  /** Open straight on this order — set by "Weigh now" links from Loading. */
  focusOrderId?: string;
};

export function TasksClient({
  organizationSlug,
  orgId,
  viewerId,
  initialTasks,
  initialPeople,
  focusOrderId,
}: TasksClientProps) {
  const { toast } = useToast();
  const t = useTranslations("tasks");
  const [state, dispatch] = useReducer(
    weighReducer,
    { initialTasks, focusOrderId },
    (init) =>
      createWeighState(init.initialTasks, {
        viewerId,
        focusOrderId: init.focusOrderId,
        nowMs: Date.now(),
      }),
  );
  const [people, setPeople] = useState(initialPeople);
  const pendingRef = useRef<Set<string>>(new Set());
  // Latest state for callbacks registered once.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Claims expire client-side too: tick once a minute so a stale amber chip
  // unblocks the queue even with no traffic.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ---- refetch (shared by realtime, claim failures, releases) ----
  const inFlightRef = useRef(0);
  const refetch = useCallback(async () => {
    inFlightRef.current += 1;
    try {
      const result = await getTodayTasks(organizationSlug);
      if (result.ok) {
        dispatch({ type: "SYNC_TASKS", tasks: result.data.tasks, nowMs: Date.now() });
        setPeople(result.data.people);
      }
    } finally {
      inFlightRef.current -= 1;
    }
  }, [organizationSlug]);

  // ---- auto-claim on first digit ----
  // One in-flight/settled claim attempt per task per approach; cleared when
  // the task leaves the queue so a released task can be re-claimed.
  const claimAttemptsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const liveTaskIds = new Set(state.queue.map((line) => line.taskId));
    for (const id of Array.from(claimAttemptsRef.current)) {
      if (!liveTaskIds.has(id) && !state.claims[id]) claimAttemptsRef.current.delete(id);
    }
  }, [state.queue, state.claims]);

  const maybeClaim = useCallback(() => {
    const snapshot = stateRef.current;
    const line = snapshot.queue[snapshot.cursor];
    if (!line) return;
    const taskId = line.taskId;
    const claim = snapshot.claims[taskId];
    if (claim?.by === viewerId) return; // already mine (local or synced)
    // Known-blocked (chip visible): don't fire a doomed RPC per keystroke.
    if (isTaskBlocked(snapshot, taskId, Date.now())) return;
    if (claimAttemptsRef.current.has(taskId)) return;
    claimAttemptsRef.current.add(taskId);
    dispatch({ type: "CLAIM_LOCAL", taskId, by: viewerId, at: new Date().toISOString() });
    void claimWeighTask({ organizationSlug, taskId, claim: true }).then((result) => {
      if (result.ok) return;
      // Always allow a later retry — the block may expire or be released.
      claimAttemptsRef.current.delete(taskId);
      if (result.code === "conflict") {
        dispatch({ type: "CLAIM_REJECTED", taskId, nowMs: Date.now() });
        toast({ title: t("claimLostTitle"), description: result.message, variant: "destructive" });
      } else {
        dispatch({ type: "CLAIM_CLEARED", taskId });
      }
      void refetch();
    });
  }, [organizationSlug, refetch, t, toast, viewerId]);

  // Every numpad/keyboard/swipe path funnels through this dispatch so the
  // first digit (or dot) into a task fires the claim exactly once.
  const dispatchWithClaim = useCallback(
    (action: WeighAction) => {
      if (action.type === "DIGIT" || action.type === "DOT") maybeClaim();
      dispatch(action);
    },
    [maybeClaim],
  );

  const release = useCallback(
    (taskId: string) => {
      dispatch({ type: "CLAIM_CLEARED", taskId });
      claimAttemptsRef.current.delete(taskId);
      void claimWeighTask({ organizationSlug, taskId, claim: false }).then(() => void refetch());
    },
    [organizationSlug, refetch],
  );

  // ---- realtime: other stations' claims and completions land here ----
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`weigh-queue-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_tasks", filter: `organization_id=eq.${orgId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void refetchRef.current(), 400);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [orgId]);

  // ---- auto-submit (unchanged except claim cleanup) ----
  useEffect(() => {
    const taskId = firstReadyUnsubmittedTaskId(state, pendingRef.current);
    if (!taskId) return;
    const weights = buildCompletePayload(state.queue, state.drafts, taskId);
    const customerName = state.queue.find((l) => l.taskId === taskId)?.customerName;
    pendingRef.current.add(taskId);
    dispatch({ type: "OPTIMISTIC_COMPLETE", taskId });
    void completeTask({ organizationSlug, taskId, weights }).then((result) => {
      pendingRef.current.delete(taskId);
      if (!result.ok) {
        dispatch({ type: "RESTORE_TASK", taskId });
        toast({ title: t("saveFailedTitle"), description: result.message, variant: "destructive" });
        void refetch();
        return;
      }
      claimAttemptsRef.current.delete(taskId);
      dispatch({ type: "COMPLETE_SUCCESS", taskId });
      toast({
        title: t("completeTitle"),
        description: customerName ? t("completeBody", { customerName }) : undefined,
      });
    });
  }, [state, organizationSlug, refetch, toast, t]);

  // Physical keyboard entry for the kiosk (md+ only, checked at event time).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (/^[0-9]$/.test(event.key)) {
        dispatchWithClaim({ type: "DIGIT", digit: event.key });
      } else if (event.key === "." || event.key === ",") {
        dispatchWithClaim({ type: "DOT" });
      } else if (event.key === "Backspace") {
        dispatchWithClaim({ type: "BACKSPACE" });
      } else if (event.key === "Enter") {
        dispatchWithClaim({ type: "NEXT", nowMs: Date.now() });
      } else if (event.key.toLowerCase() === "p") {
        dispatchWithClaim({ type: "TOGGLE_TARGET" });
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatchWithClaim]);

  return (
    <div className="flex h-[calc(100svh-4rem-1.5rem)] flex-col gap-4 md:h-[calc(100svh-4rem-2rem)]">
      <WeighStation
        state={state}
        dispatch={dispatchWithClaim}
        people={people}
        nowMs={nowMs}
        onRelease={release}
        className="hidden md:flex"
      />
      <SwipeDeck
        state={state}
        dispatch={dispatchWithClaim}
        people={people}
        nowMs={nowMs}
        className="flex md:hidden"
      />
    </div>
  );
}
```

Notes for the implementer:
- `WeighStation`/`SwipeDeck` don't accept `people`/`nowMs`/`onRelease` yet — Task 6 adds them. To keep this commit compiling, Task 5 and Task 6 may be committed together if the intermediate state won't typecheck; prefer implementing Task 6's prop signatures first, UI rendering second.
- `NEXT`/`SKIP` dispatched from inside `WeighStation`/`SwipeDeck` (numpad buttons, swipe gestures) also need `nowMs: Date.now()` at their call sites — Task 6 covers those edits.
- i18n: add `tasks.claimLostTitle` — EN `"Order taken"`, MS `"Pesanan diambil"` — next to `saveFailedTitle` in both message files.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: only errors pointing into `weigh-station.tsx` / `swipe-deck.tsx` / `queue-rail.tsx` prop mismatches (fixed in Task 6). If clean, better.

- [ ] **Step 4: Commit (may be folded into Task 6's commit if typecheck blocks)**

```bash
git add "src/app/[locale]/(seller)/[organizationSlug]/tasks/page.tsx" "src/app/[locale]/(seller)/[organizationSlug]/tasks/tasks-client.tsx" src/messages/en.json src/messages/ms.json
git commit -m "feat(tasks): auto-claim on first digit, realtime queue sync, viewer context"
```

---

### Task 6: UI — claim chips, release control, nowMs threading

**Files:**
- Modify: `src/features/orders/components/weigh-station.tsx` (accept + forward `people`, `nowMs`, `onRelease`; pass `nowMs` on `NEXT`/`SKIP` dispatches)
- Modify: `src/features/orders/components/queue-rail.tsx` (chip + release)
- Modify: `src/features/orders/components/swipe-deck.tsx` (chip on the top card; `nowMs` on swipe-committed `SKIP`/`NEXT` and on-screen numpad `NEXT`)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`orders.queue.claimedBy`, `orders.queue.release`)
- Test: `src/features/orders/tests/unit/weigh-model.test.ts` already covers the logic; UI changes verified by typecheck + browser (Task 7)

**Interfaces:**
- Consumes: `isTaskBlocked(state, taskId, nowMs)`, `state.claims`, `people` map, `onRelease(taskId)` (Tasks 4–5).
- Produces: `WeighStationProps` and `SwipeDeckProps` gain `people: Record<string, string>; nowMs: number;` (WeighStation also `onRelease: (taskId: string) => void`); `QueueRailProps` gains `claims`, `viewerId` (or the computed `blocked` map — see below), `nowMs`, `onRelease`.

- [ ] **Step 1: i18n strings**

`en.json` under `orders.queue`:

```json
"claimedBy": "{name} weighing",
"claimedByFallback": "Another worker weighing",
"release": "Release"
```

`ms.json` under `orders.queue`:

```json
"claimedBy": "{name} sedang menimbang",
"claimedByFallback": "Pekerja lain sedang menimbang",
"release": "Lepaskan"
```

- [ ] **Step 2: `weigh-station.tsx`**

Extend props and forward:

```tsx
type WeighStationProps = {
  state: WeighState;
  dispatch: (action: WeighAction) => void;
  people: Record<string, string>;
  nowMs: number;
  onRelease: (taskId: string) => void;
  className?: string;
};
```

Pass `claims={state.claims}`, `viewerId={state.viewerId}`, `people`, `nowMs`, `onRelease` into `<QueueRail …>`. Wherever the station dispatches `{ type: "NEXT" }` or `{ type: "SKIP" }` (numpad Next/Skip buttons), change to `{ type: "NEXT", nowMs: Date.now() }` / `{ type: "SKIP", nowMs: Date.now() }`.

- [ ] **Step 3: `queue-rail.tsx`**

Extend props:

```tsx
type QueueRailProps = {
  queue: WeighLine[];
  confirmed: Record<string, true>;
  cursor: number;
  pendingRemovals: WeighState["pendingRemovals"];
  claims: WeighState["claims"];
  viewerId: string | null;
  people: Record<string, string>;
  nowMs: number;
  onSelect: (index: number) => void;
  onRelease: (taskId: string) => void;
};
```

Inside the `groups.map`, compute the active other-claim (import `isClaimActive` from `@/lib/claims` — the rail receives raw pieces, not the whole state, so call it directly):

```tsx
const claim = claims[group.taskId];
const blockedBy =
  claim && claim.by !== viewerId && isClaimActive(claim.at, nowMs) ? claim.by : null;
```

When `blockedBy !== null` and the group is not saving, render under the customer-name row (amber, matching the loading board's chip tone):

```tsx
<span className="flex items-center justify-between gap-2">
  <span className="truncate text-xs font-medium text-amber-600 dark:text-amber-500">
    {people[blockedBy] ? t("claimedBy", { name: people[blockedBy] }) : t("claimedByFallback")}
  </span>
  <button
    type="button"
    className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
    onClick={(event) => {
      event.stopPropagation();
      onRelease(group.taskId);
    }}
  >
    {t("release")}
  </button>
</span>
```

Row click (`onSelect`) stays enabled for blocked groups — `GO_TO` is free; only typing claims.

- [ ] **Step 4: `swipe-deck.tsx`**

Extend props with `people: Record<string, string>` and `nowMs: number`. Where the deck dispatches `SKIP` (left-swipe commit) and `NEXT` (right action / numpad), add `nowMs: Date.now()`. Above the top card, when the current line's task is blocked, render a chip:

```tsx
{line && isTaskBlocked(state, line.taskId, nowMs) && (
  <div className="mx-auto w-fit rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-500">
    {(() => {
      const by = state.claims[line.taskId]?.by;
      const name = by ? people[by] : undefined;
      return name ? tQueue("claimedBy", { name }) : tQueue("claimedByFallback");
    })()}
  </div>
)}
```

(`const tQueue = useTranslations("orders.queue");` — the deck currently only loads `orders.numpad` / `orders.swipeCard`.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/features/orders src/features/logistics src/lib`
Expected: all clean/PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/orders/components src/messages/en.json src/messages/ms.json "src/app/[locale]/(seller)/[organizationSlug]/tasks"
git commit -m "feat(tasks): claim chips, release control, blocked-task skip in weigh UI"
```

---

### Task 7: End-to-end verification (two browsers, one queue)

**Files:** none (manual verification against local Supabase + dev server)

- [ ] **Step 1: Seed and start**

Data console → Seed demo data (post-`db:reset` from Task 1). Start the dev server via the browser-pane launch config (never Bash).

- [ ] **Step 2: Two-worker collision script**

1. Tab A: log in `warehouse@gmail.com` / `password123`, open `/tasks`.
2. Tab B (separate browser profile/incognito): log in `seller@gmail.com` / `password123`, open `/tasks`. Both cursors should sit on the same first order (neither has typed).
3. Tab A: type a digit. Within ~1s Tab B shows the amber "{name} weighing" chip on that order, and Tab B's Enter/Skip advance skips it.
4. Tab B: click the claimed order (GO_TO works), type a digit → expect the conflict toast "Another worker is weighing that order right now", drafts cleared, cursor auto-advanced.
5. Tab A: finish weighing all lines → order auto-submits; Tab B's queue drops it live.
6. Tab B: claim an order (type a digit), then Tab A clicks **Release** on it → Tab B's next claim attempt on it succeeds.
7. Reload Tab A mid-claim: initial cursor must land on the first unclaimed order, not the one Tab B holds.

- [ ] **Step 3: Full gates**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Update memory/ledger and stop**

No commit here unless fixes were needed; if they were, commit them with `fix(tasks): …`.
