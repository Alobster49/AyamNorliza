# Driver Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a driver start their own run, key final weights at the door (which become the billed totals), and hand the customer a printable per-order invoice.

**Architecture:** Extends the existing `/drive/[organizationSlug]` driver deck. One new migration adds `driver_start_run` and replaces `driver_deliver_stop` with a weights-aware version that reuses the `close_order` validation pattern. `order_items.line_total` is a generated column (`final_weight_kg × price_per_kg`), so writing final weights and recomputing `orders.total_amount` is the entire pricing change. A new server-rendered invoice route prints via browser print CSS, following the run-manifest pattern.

**Tech Stack:** Next.js 16 App Router, next-intl, Supabase (Postgres RPCs, RLS, pgTAP), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-driver-run-flow-design.md`

## Global Constraints

- Drivers can NEVER override `price_per_kg` — confirm-time price stands.
- Every non-cancelled item must get `final_weight_kg > 0` at deliver time (piece-mode items too; `final_pieces` optional).
- Weight write + delivery record must be one transaction (one RPC).
- All user-facing strings go through next-intl: add keys to BOTH `src/messages/en.json` and `src/messages/ms.json`. After editing en.json run `npm run typecheck` (en.d.json.ts is generated from it — if typecheck complains about the declaration file, check how `src/messages/en.d.json.ts` is produced and regenerate).
- Repo gotcha: every new/replaced SQL function needs `revoke all ... from public; grant execute ... to authenticated;`.
- Migrations run with `npm run db:reset` (local supabase must be running), pgTAP with `npm run db:test`, types regen with `npm run db:types`.
- Commit after every task. Do not push.

---

### Task 1: Migration — `driver_start_run` + weights-aware `driver_deliver_stop`

**Files:**
- Create: `supabase/migrations/20260826000002_driver_run_flow.sql`
- Modify: `src/types/database.generated.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces RPC `driver_start_run(p_run uuid) returns void`. Errors (errcode P0001 messages): `not_found`, `forbidden`, `invalid_transition`.
- Produces RPC `driver_deliver_stop(p_order uuid, p_received_by text, p_signature_path text, p_photo_path text, p_cash_collected numeric, p_lines jsonb) returns numeric` (returns new order total). Existing errors kept (`not_found`, `forbidden`, `invalid_status`, `invalid_amount`) plus `lines_incomplete`, `invalid_weight`.
- `p_lines` element shape: `{"item_id": "<uuid>", "final_weight_kg": <number>, "final_pieces": <int|null>}`.

- [ ] **Step 1: Write the migration**

```sql
-- Driver run flow: the driver starts their own run and keys final weights at
-- the door. The weights the driver records are the billed truth -- line_total
-- is generated from final_weight_kg * price_per_kg, and this migration makes
-- driver_deliver_stop write those weights and the recomputed order total in
-- the same transaction as the delivery record.

begin;

-- ---------------------------------------------------------------------------
-- driver_start_run: the driver (or the office on their behalf) departs the
-- run they are assigned to. Same side effect as dispatch_depart_truck:
-- non-ready orders are released back to the pool before the truck leaves.
-- ---------------------------------------------------------------------------
create or replace function public.driver_start_run(p_run uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_current public.delivery_run_status;
begin
  select organization_id, status into v_org, v_current
  from public.delivery_runs where id = p_run for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(p_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_current <> 'planned' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  update public.orders
  set run_id = null, assignment_source = 'none'
  where run_id = p_run and status <> 'ready';

  update public.delivery_runs set status = 'departed' where id = p_run;
end;
$$;

revoke all on function public.driver_start_run(uuid) from public;
grant execute on function public.driver_start_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- driver_deliver_stop: goods handed over, weighed at the door.
--
-- Replaces the 5-arg version. p_lines must cover every non-cancelled item
-- exactly once with final_weight_kg > 0 (validation mirrors close_order).
-- Price is NEVER taken from p_lines: the confirm-time price_per_kg stands.
-- Returns the recomputed order total so the client can show it immediately.
-- ---------------------------------------------------------------------------
drop function if exists public.driver_deliver_stop(uuid, text, text, text, numeric);

create or replace function public.driver_deliver_stop(
  p_order uuid,
  p_received_by text default null,
  p_signature_path text default null,
  p_photo_path text default null,
  p_cash_collected numeric default null,
  p_lines jsonb default null
)
returns numeric
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_run uuid;
  v_status public.order_status;
  v_item_count integer;
  v_line jsonb;
  v_item_id uuid;
  v_weight numeric;
  v_pieces integer;
  v_pieces_text text;
  v_seen_ids uuid[] := '{}';
  v_total numeric;
begin
  select o.organization_id, o.run_id, o.status into v_org, v_run, v_status
  from public.orders o where o.id = p_order for update;

  if v_org is null or v_run is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(v_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  -- Delivering the same stop twice is a no-op, not an error: the driver's
  -- phone may retry a queued write after the office already recorded it.
  if v_status in ('delivered', 'closed') then
    return (select total_amount from public.orders where id = p_order);
  end if;

  if v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if p_cash_collected is not null and p_cash_collected < 0 then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'lines_incomplete';
  end if;

  select count(*) into v_item_count
  from public.order_items where order_id = p_order and is_cancelled = false;

  -- Validation pass: every line must name a real, distinct, not-cancelled
  -- item on this order with final_weight_kg > 0, and every item must be
  -- covered, before any row is touched. Mirrors close_order.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := public._order_safe_uuid(v_line->>'item_id');

    if v_item_id is null or v_item_id = any(v_seen_ids) then
      raise exception using errcode = 'P0001', message = 'lines_incomplete';
    end if;

    if not exists (
      select 1 from public.order_items
      where id = v_item_id and order_id = p_order and is_cancelled = false
    ) then
      raise exception using errcode = 'P0001', message = 'lines_incomplete';
    end if;

    v_seen_ids := array_append(v_seen_ids, v_item_id);

    v_weight := public._order_safe_numeric(v_line->>'final_weight_kg');
    if v_weight is null or v_weight <= 0 then
      raise exception using errcode = 'P0001', message = 'invalid_weight';
    end if;

    v_pieces_text := nullif(v_line->>'final_pieces', '');
    if v_pieces_text is not null and public._order_safe_integer(v_pieces_text) is null then
      raise exception using errcode = 'P0001', message = 'lines_incomplete';
    end if;
  end loop;

  if coalesce(array_length(v_seen_ids, 1), 0) <> v_item_count then
    raise exception using errcode = 'P0001', message = 'lines_incomplete';
  end if;

  -- Apply pass. price_per_kg is intentionally untouched.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := public._order_safe_uuid(v_line->>'item_id');
    v_weight := public._order_safe_numeric(v_line->>'final_weight_kg');
    v_pieces_text := nullif(v_line->>'final_pieces', '');
    v_pieces := case when v_pieces_text is null then null else public._order_safe_integer(v_pieces_text) end;

    update public.order_items
    set final_weight_kg = v_weight, final_pieces = v_pieces
    where id = v_item_id and order_id = p_order;

    insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
    values (v_org, v_item_id, 'final', v_weight, v_pieces, auth.uid());
  end loop;

  select coalesce(sum(line_total), 0) into v_total
  from public.order_items
  where order_id = p_order and is_cancelled = false;

  insert into public.run_stop_events (organization_id, run_id, order_id, kind, recorded_by)
  values (v_org, v_run, p_order, 'leave', auth.uid());

  insert into public.delivery_attempts (
    organization_id, run_id, order_id, outcome,
    received_by, signature_path, photo_path, cash_collected, recorded_by
  )
  values (
    v_org, v_run, p_order, 'delivered',
    nullif(btrim(coalesce(p_received_by, '')), ''), p_signature_path, p_photo_path,
    p_cash_collected, auth.uid()
  );

  update public.orders set total_amount = v_total, status = 'delivered' where id = p_order;

  return v_total;
end;
$$;

revoke all on function public.driver_deliver_stop(uuid, text, text, text, numeric, jsonb) from public;
grant execute on function public.driver_deliver_stop(uuid, text, text, text, numeric, jsonb) to authenticated;

commit;
```

Note: before writing, open `supabase/migrations/20260826000001_confirm_price.sql` and confirm the helper names `_order_safe_uuid`, `_order_safe_numeric`, `_order_safe_integer` exist (they are used by `close_order`). If a helper has a different name, use the name `close_order` uses.

- [ ] **Step 2: Apply and verify**

Run: `npm run db:reset`
Expected: all migrations apply cleanly, including `20260826000002_driver_run_flow`.

Run: `npm run db:test`
Expected: existing pgTAP suites under `supabase/tests/rls/` still pass (RLS unchanged; this catches accidental breakage).

- [ ] **Step 3: Regenerate DB types**

Run: `npm run db:types`
Expected: `src/types/database.generated.ts` now shows `driver_start_run` and the 6-arg `driver_deliver_stop` returning `number`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260826000002_driver_run_flow.sql src/types/database.generated.ts
git commit -m "feat(db): driver_start_run + weights-aware driver_deliver_stop"
```

---

### Task 2: Server actions — `startRun` + weights in `deliverStop`

**Files:**
- Modify: `src/features/orders/server/driver-actions.ts`
- Test: `src/features/orders/tests/unit/driver-actions-message-keys.test.ts`
- Modify: `src/messages/en.json`, `src/messages/ms.json` (error keys only)

**Interfaces:**
- Consumes: RPCs from Task 1.
- Produces: `startRun(organizationSlug: string, runId: string): Promise<ActionResult>` and `deliverStop(organizationSlug, orderId, proof: DeliverStopInput)` where `DeliverStopInput` gains `lines: DeliverLineInput[]` with `type DeliverLineInput = { itemId: string; finalWeightKg: number; finalPieces?: number | null }`. Both exported from `driver-actions.ts`. Task 4's deck calls these.

- [ ] **Step 1: Write failing tests**

Append to `driver-actions-message-keys.test.ts` (reuse the file's existing `mockSupabaseRpc` / `mockDriverGuard` helpers; import `startRun` alongside the existing imports):

```ts
describe("startRun", () => {
  it("maps invalid_transition to errors.drive.run.alreadyStarted", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_transition" } });
    const result = await startRun("org-slug", "run-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.alreadyStarted");
  });

  it("calls driver_start_run and succeeds", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await startRun("org-slug", "run-1");
    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("driver_start_run", { p_run: "run-1" });
  });
});

describe("deliverStop weights", () => {
  it("rejects an empty lines array before calling the RPC", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await deliverStop("org-slug", "order-1", { lines: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.weightsMissing");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-positive weight before calling the RPC", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await deliverStop("org-slug", "order-1", {
      lines: [{ itemId: "item-1", finalWeightKg: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidWeight");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("passes snake_case lines to driver_deliver_stop", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await deliverStop("org-slug", "order-1", {
      cashCollected: 50,
      lines: [{ itemId: "item-1", finalWeightKg: 2.35, finalPieces: 2 }],
    });
    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("driver_deliver_stop", {
      p_order: "order-1",
      p_received_by: null,
      p_signature_path: null,
      p_photo_path: null,
      p_cash_collected: 50,
      p_lines: [{ item_id: "item-1", final_weight_kg: 2.35, final_pieces: 2 }],
    });
  });

  it("maps invalid_weight RPC error to errors.drive.stop.invalidWeight", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_weight" } });
    const result = await deliverStop("org-slug", "order-1", {
      lines: [{ itemId: "item-1", finalWeightKg: 2 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidWeight");
  });
});
```

Also update any EXISTING `deliverStop` test in that file that calls it without `lines` — those must now pass `lines: [{ itemId: "item-1", finalWeightKg: 1 }]` (read the file first; keep its assertions otherwise intact).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/orders/tests/unit/driver-actions-message-keys.test.ts`
Expected: FAIL — `startRun` not exported; lines handling missing.

- [ ] **Step 3: Implement in `driver-actions.ts`**

Add below `arriveStop`:

```ts
/**
 * `driver_start_run` errors, mapped the same way `stopMessageKey` maps stop
 * RPC errors — see that function's comment for why the mapping lives here.
 */
function startRunMessageKey(rawMessage: string): string {
  switch (rawMessage) {
    case "forbidden":
      return "errors.drive.run.forbidden";
    case "not_found":
      return "errors.drive.run.notFound";
    case "invalid_transition":
      return "errors.drive.run.alreadyStarted";
    default:
      return "errors.drive.run.internal";
  }
}

/** The driver pulls out of the yard. Non-ready orders return to the pool. */
export async function startRun(organizationSlug: string, runId: string): Promise<ActionResult> {
  const ctx = await guard(organizationSlug);
  if (!ctx.ok) return err(ctx.code, ctx.message, ctx.messageKey);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("driver_start_run", { p_run: runId });
  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as DriverErrorCode, mapped.message, startRunMessageKey(error.message));
  }

  revalidatePath(`/drive/${organizationSlug}`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}
```

Replace `DeliverStopInput` and `deliverStop`:

```ts
export type DeliverLineInput = {
  itemId: string;
  finalWeightKg: number;
  finalPieces?: number | null;
};

export type DeliverStopInput = {
  receivedBy?: string | null;
  signaturePath?: string | null;
  photoPath?: string | null;
  cashCollected?: number | null;
  /** One entry per live item; the weights become the billed totals. */
  lines: DeliverLineInput[];
};

/** Goods handed over and weighed. Proof fields optional; weights are not. */
export async function deliverStop(
  organizationSlug: string,
  orderId: string,
  proof: DeliverStopInput,
): Promise<ActionResult> {
  if (proof.cashCollected !== null && proof.cashCollected !== undefined && proof.cashCollected < 0) {
    return err("validation", "Cash collected cannot be negative.", "errors.drive.stop.invalidAmount");
  }
  if (!proof.lines || proof.lines.length === 0) {
    return err("validation", "Weights are required.", "errors.drive.stop.weightsMissing");
  }
  for (const line of proof.lines) {
    if (!Number.isFinite(line.finalWeightKg) || line.finalWeightKg <= 0) {
      return err("validation", "Each item needs a weight above zero.", "errors.drive.stop.invalidWeight");
    }
  }

  return callStopRpc(organizationSlug, "driver_deliver_stop", {
    p_order: orderId,
    p_received_by: proof.receivedBy ?? null,
    p_signature_path: proof.signaturePath ?? null,
    p_photo_path: proof.photoPath ?? null,
    p_cash_collected: proof.cashCollected ?? null,
    p_lines: proof.lines.map((line) => ({
      item_id: line.itemId,
      final_weight_kg: line.finalWeightKg,
      final_pieces: line.finalPieces ?? null,
    })),
  });
}
```

Extend `stopMessageKey` with the two new raw codes:

```ts
    case "lines_incomplete":
      return "errors.drive.stop.weightsMissing";
    case "invalid_weight":
      return "errors.drive.stop.invalidWeight";
```

- [ ] **Step 4: Add error message keys**

In `src/messages/en.json`, find `"errors"` → `"drive"` (near line 477). Under `drive.run` add:

```json
"alreadyStarted": "This run has already left the yard.",
"notFound": "Run not found."
```

Under `drive.stop` add:

```json
"weightsMissing": "Key a weight for every item before confirming.",
"invalidWeight": "Each item needs a weight above zero."
```

In `src/messages/ms.json`, same structure:

```json
"alreadyStarted": "Trip ini sudah bertolak.",
"notFound": "Trip tidak dijumpai."
```

```json
"weightsMissing": "Masukkan berat untuk setiap item sebelum sahkan.",
"invalidWeight": "Setiap item perlu berat melebihi sifar."
```

(Match the surrounding key style in each file — read the existing `errors.drive` block first and keep alphabetical/order conventions it uses.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/features/orders/tests/unit/driver-actions-message-keys.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS (deck still compiles because Task 4 hasn't changed it yet — if `driver-deck.tsx` fails on the now-required `lines`, add a temporary `lines: []` at its `deliverStop` call site and note that Task 4 replaces it).

- [ ] **Step 6: Commit**

```bash
git add src/features/orders/server/driver-actions.ts src/features/orders/tests/unit/driver-actions-message-keys.test.ts src/messages/en.json src/messages/ms.json src/features/orders/components/driver-deck.tsx
git commit -m "feat(drive): startRun action + final weights through deliverStop"
```

---

### Task 3: Deck model — run status + per-item lines + live total

**Files:**
- Modify: `src/features/orders/lib/driver-run-model.ts`
- Test: `src/features/orders/tests/unit/driver-run-model.test.ts`

**Interfaces:**
- Consumes: `RunWithOrders`, `OrderItemWithProduct` from `../types`.
- Produces:
  - `DriverStop` gains `items: StopItem[]` where `type StopItem = { itemId: string; productName: string | null; mode: "piece" | "kg"; quantity: number; warehouseWeightKg: number | null; pricePerKg: number | null }`.
  - `DriverDeck` gains `runStatus: RunWithOrders["status"]` (`"planned" | "departed" | "completed"`).
  - New pure helper `linesTotal(entries: { weightKg: number | null; pricePerKg: number | null }[]): number` — sum of `weightKg × pricePerKg` over entries where both are set, rounded to 2 dp.
  - Task 4 consumes all three.

- [ ] **Step 1: Write failing tests**

Read `driver-run-model.test.ts` first and reuse its existing run/order fixture builders. Add:

```ts
describe("deck items and run status", () => {
  it("exposes runStatus and per-stop items with price and warehouse weight", () => {
    // Build a run fixture with status 'planned' and one order with one kg-mode
    // item: quantity 2, warehouse_weight_kg 2.1, price_per_kg 12, product name "Ayam Super".
    const deck = buildDriverDeck(run);
    expect(deck.runStatus).toBe("planned");
    expect(deck.stops[0].items).toEqual([
      {
        itemId: item.id,
        productName: "Ayam Super",
        mode: "kg",
        quantity: 2,
        warehouseWeightKg: 2.1,
        pricePerKg: 12,
      },
    ]);
  });

  it("excludes cancelled items", () => {
    // Fixture: one live item + one with is_cancelled true.
    const deck = buildDriverDeck(run);
    expect(deck.stops[0].items).toHaveLength(1);
  });
});

describe("linesTotal", () => {
  it("sums weight × price and rounds to 2 dp", () => {
    expect(
      linesTotal([
        { weightKg: 2.335, pricePerKg: 12 },
        { weightKg: 1, pricePerKg: 10.5 },
      ]),
    ).toBe(38.52);
  });

  it("skips entries missing weight or price", () => {
    expect(
      linesTotal([
        { weightKg: null, pricePerKg: 12 },
        { weightKg: 2, pricePerKg: null },
        { weightKg: 3, pricePerKg: 10 },
      ]),
    ).toBe(30);
  });
});
```

(The comment lines describe the fixture to build with the file's existing helpers — write real fixture code, not comments, when implementing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/orders/tests/unit/driver-run-model.test.ts`
Expected: FAIL — `items`/`runStatus`/`linesTotal` missing.

- [ ] **Step 3: Implement**

In `driver-run-model.ts`:

```ts
export type StopItem = {
  itemId: string;
  productName: string | null;
  mode: "piece" | "kg";
  quantity: number;
  warehouseWeightKg: number | null;
  pricePerKg: number | null;
};
```

Add `items: StopItem[];` to `DriverStop` and `runStatus: RunWithOrders["status"];` to `DriverDeck`. In `buildDriverDeck`'s stop mapping add:

```ts
    items: (order.items ?? [])
      .filter((item) => !item.is_cancelled)
      .map((item) => ({
        itemId: item.id,
        productName: item.product?.name ?? null,
        mode: item.mode,
        quantity: item.quantity,
        warehouseWeightKg: item.warehouse_weight_kg,
        pricePerKg: item.price_per_kg,
      })),
```

In the return object add `runStatus: run.status,`. Add the helper:

```ts
/** Live door total while the driver keys weights. Entries missing either side count 0. */
export function linesTotal(entries: { weightKg: number | null; pricePerKg: number | null }[]): number {
  const sum = entries.reduce(
    (acc, entry) =>
      entry.weightKg !== null && entry.pricePerKg !== null ? acc + entry.weightKg * entry.pricePerKg : acc,
    0,
  );
  return Math.round(sum * 100) / 100;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/orders/tests/unit/driver-run-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/lib/driver-run-model.ts src/features/orders/tests/unit/driver-run-model.test.ts
git commit -m "feat(drive): deck model exposes run status, stop items, live total"
```

---

### Task 4: Deck UI — start-run button + weight inputs + invoice links

**Files:**
- Modify: `src/features/orders/components/driver-deck.tsx`
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`orders.driverDeck` keys)

**Interfaces:**
- Consumes: `startRun`, `deliverStop` (Task 2); `linesTotal`, `deck.runStatus`, `stop.items` (Task 3).
- Produces: invoice links pointing at `/${locale-relative}/drive/${organizationSlug}/invoice/${orderId}` — Task 5 must create that route. Use next-intl's `Link` if the repo uses `@/i18n/navigation` (check how `driver-deck.tsx` or nearby components link today; plain `<a href={`/drive/...`}>` is wrong if a locale-aware `Link` is the convention — grep `from "@/i18n` in `src/` and copy that pattern).

- [ ] **Step 1: Start-run state**

In `DriverDeck`, add a handler next to `handleArrive`:

```ts
  function handleStartRun() {
    startTransition(async () => {
      const result = await startRun(organizationSlug, run.id);
      if (!result.ok) {
        toast({
          title: t("toast.startRunFailedTitle"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("toast.startedTitle") });
      await refresh();
    });
  }
```

Import `startRun` from `../server/driver-actions`. In the JSX, when `deck.runStatus === "planned"`, replace the stop card's action block (the `handleArrive` / deliver / fail buttons area) with:

```tsx
              <div className="flex flex-col gap-2 p-4">
                <p className="text-center text-xs text-muted-foreground">{t("startRun.hint")}</p>
                <Button size="lg" className="h-12 w-full text-base" disabled={busy} onClick={handleStartRun}>
                  {t("startRun.button")}
                </Button>
              </div>
```

The route list and stop details stay visible so the driver can review before leaving.

- [ ] **Step 2: Weight inputs in the deliver sheet**

State: replace nothing else; add

```ts
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [pieces, setPieces] = useState<Record<string, string>>({});
```

Reset both in `resetSheet` (`setWeights({}); setPieces({});`).

Derived values (below `const stop = deck.current;`):

```ts
  const weightEntries = (stop?.items ?? []).map((item) => {
    const raw = weights[item.itemId]?.trim() ?? "";
    const parsed = raw === "" ? null : Number(raw);
    const valid = parsed !== null && Number.isFinite(parsed) && parsed > 0;
    return { item, raw, weightKg: valid ? parsed : null, valid };
  });
  const allWeightsValid = weightEntries.length > 0 && weightEntries.every((entry) => entry.valid);
  const liveTotal = linesTotal(
    weightEntries.map((entry) => ({ weightKg: entry.weightKg, pricePerKg: entry.item.pricePerKg })),
  );
```

Import `linesTotal` from `../lib/driver-run-model`.

In the deliver sheet, ABOVE the received-by field, render one block per item:

```tsx
              {weightEntries.map(({ item, raw }) => (
                <label key={item.itemId} className="flex flex-col gap-1 text-xs font-medium">
                  <span>
                    {item.productName ?? t("deliverSheet.itemFallback")}
                    {item.pricePerKg !== null ? ` · ${formatPrice(item.pricePerKg)}/kg` : ""}
                  </span>
                  <div className="flex gap-2">
                    <Input
                      value={raw}
                      onChange={(event) =>
                        setWeights((prev) => ({ ...prev, [item.itemId]: event.target.value }))
                      }
                      inputMode="decimal"
                      placeholder={
                        item.warehouseWeightKg !== null
                          ? t("deliverSheet.weightPlaceholderKg", { weight: item.warehouseWeightKg })
                          : t("deliverSheet.weightPlaceholder")
                      }
                      className="h-11 flex-[2]"
                    />
                    {item.mode === "piece" && (
                      <Input
                        value={pieces[item.itemId] ?? ""}
                        onChange={(event) =>
                          setPieces((prev) => ({ ...prev, [item.itemId]: event.target.value }))
                        }
                        inputMode="numeric"
                        placeholder={t("deliverSheet.piecesPlaceholder", { count: item.quantity })}
                        className="h-11 flex-1"
                      />
                    )}
                  </div>
                </label>
              ))}

              <div className="flex items-center justify-between rounded-xl bg-accent/40 px-3 py-2">
                <span className="text-xs font-medium">{t("deliverSheet.liveTotal")}</span>
                <span className="text-base font-semibold tabular-nums">{formatPrice(liveTotal)}</span>
              </div>
```

Change the cash input placeholder from `formatPrice(stop.amount)` to `formatPrice(liveTotal)`.

In `handleDeliver`, build lines and block submit until valid:

```ts
    if (!allWeightsValid) {
      toast({
        title: t("toast.weightsMissingTitle"),
        description: tRoot("errors.drive.stop.weightsMissing" as never),
        variant: "destructive",
      });
      return;
    }
```

and pass to the action:

```ts
      const result = await deliverStop(organizationSlug, stop.orderId, {
        receivedBy: receivedBy.trim() || null,
        photoPath,
        cashCollected,
        lines: weightEntries.map(({ item, weightKg }) => {
          const piecesRaw = pieces[item.itemId]?.trim() ?? "";
          const parsedPieces = piecesRaw === "" ? null : Number.parseInt(piecesRaw, 10);
          return {
            itemId: item.itemId,
            finalWeightKg: weightKg as number,
            finalPieces: parsedPieces !== null && Number.isInteger(parsedPieces) && parsedPieces >= 0 ? parsedPieces : null,
          };
        }),
      });
```

Also disable the sheet's confirm button when weights invalid: `disabled={busy || photoBusy || !allWeightsValid}`.

Remove the temporary `lines: []` shim if Task 2 added one.

- [ ] **Step 3: Invoice links**

In the whole-run `<details>` list, for delivered stops replace the plain status `<span>` with a link (locale-aware Link per the repo convention found in the Interfaces note):

```tsx
                  {item.outcome === "delivered" ? (
                    <Link
                      href={`/drive/${organizationSlug}/invoice/${item.orderId}`}
                      className="shrink-0 text-[11px] font-medium underline underline-offset-2"
                    >
                      {t("stopStatus.invoice")}
                    </Link>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {/* existing failed/cancelled/hereNow/toDo branches unchanged */}
                    </span>
                  )}
```

On the finished screen add below the summary paragraph:

```tsx
          <p className="text-xs text-muted-foreground">{t("finished.invoiceHint")}</p>
```

- [ ] **Step 4: i18n keys**

`en.json` under `orders.driverDeck` (merge into existing objects — `toast`, `deliverSheet`, `stopStatus`, `finished` already exist):

```json
"startRun": {
  "hint": "Check the route below, then pull out.",
  "button": "Start delivering"
},
"toast": {
  "startRunFailedTitle": "Could not start the run",
  "startedTitle": "Run started. Drive safe.",
  "weightsMissingTitle": "Weights missing"
},
"deliverSheet": {
  "itemFallback": "Item",
  "weightPlaceholder": "Weight (kg)",
  "weightPlaceholderKg": "Weighed {weight} kg at the warehouse",
  "piecesPlaceholder": "{count} pcs",
  "liveTotal": "Total to collect"
},
"stopStatus": {
  "invoice": "Invoice"
},
"finished": {
  "invoiceHint": "Open any delivered stop in the list above for its invoice."
}
```

`ms.json`, same structure:

```json
"startRun": {
  "hint": "Semak laluan di bawah, kemudian bertolak.",
  "button": "Mula hantar"
},
"toast": {
  "startRunFailedTitle": "Tidak dapat mulakan trip",
  "startedTitle": "Trip bermula. Pandu selamat.",
  "weightsMissingTitle": "Berat belum diisi"
},
"deliverSheet": {
  "itemFallback": "Item",
  "weightPlaceholder": "Berat (kg)",
  "weightPlaceholderKg": "Ditimbang {weight} kg di gudang",
  "piecesPlaceholder": "{count} ekor",
  "liveTotal": "Jumlah kutipan"
},
"stopStatus": {
  "invoice": "Invois"
},
"finished": {
  "invoiceHint": "Buka mana-mana hantaran selesai dalam senarai di atas untuk invoisnya."
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run src/features/orders`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/orders/components/driver-deck.tsx src/messages/en.json src/messages/ms.json
git commit -m "feat(drive): start-run button, door weights with live total, invoice links"
```

---

### Task 5: Invoice page

**Files:**
- Create: `src/app/[locale]/drive/[organizationSlug]/invoice/[orderId]/page.tsx`
- Create: `src/app/[locale]/drive/[organizationSlug]/invoice/[orderId]/print-button.tsx` (copy `src/app/[locale]/(seller)/[organizationSlug]/runs/[runId]/manifest/print-button.tsx` verbatim — read it first; if it is a trivial client component, reuse by importing it instead of copying, whichever the manifest's button allows without crossing route-group boundaries awkwardly)
- Modify: `src/features/orders/server/driver-actions.ts` (new `getDriverInvoice` action)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`drive.invoice` keys)
- Test: `src/features/orders/tests/unit/driver-actions-message-keys.test.ts`

**Interfaces:**
- Consumes: `guard`, `err`, `ok` already in `driver-actions.ts`; `formatPrice`, `formatWeight` from `../lib/order-model`.
- Produces: `getDriverInvoice(organizationSlug: string, orderId: string): Promise<ActionResult<DriverInvoicePayload>>` where

```ts
export type DriverInvoicePayload = {
  organizationName: string;
  order: OrderWithItems;          // items + product + customer + zone joined
  deliveredAttempt: DeliveryAttempt | null; // latest outcome='delivered' attempt
};
```

- [ ] **Step 1: Failing test for the action**

Append to `driver-actions-message-keys.test.ts`:

```ts
describe("getDriverInvoice", () => {
  it("returns forbidden messageKey when the guard rejects", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError("Not authenticated"));
    const result = await getDriverInvoice("org-slug", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.unauthenticated");
  });
});
```

Run: `npx vitest run src/features/orders/tests/unit/driver-actions-message-keys.test.ts`
Expected: FAIL — `getDriverInvoice` not exported.

- [ ] **Step 2: Implement `getDriverInvoice`**

In `driver-actions.ts`:

```ts
export type DriverInvoicePayload = {
  organizationName: string;
  order: OrderWithItems;
  deliveredAttempt: DeliveryAttempt | null;
};

/**
 * One delivered order, priced by the weights keyed at the door. RLS scopes
 * drivers to their own runs' orders; the office sees its whole org.
 */
export async function getDriverInvoice(
  organizationSlug: string,
  orderId: string,
): Promise<ActionResult<DriverInvoicePayload>> {
  const ctx = await guard(organizationSlug);
  if (!ctx.ok) return err(ctx.code, ctx.message, ctx.messageKey);

  const supabase = await createSupabaseServerClient();
  const [{ data: org }, { data: order, error }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", ctx.orgId).single(),
    supabase
      .from("orders")
      .select(
        `
        *,
        zone:delivery_zones(*),
        slot:delivery_slots(*),
        customer:customers(id, name, phone),
        items:order_items(*, product:products(id, name, image_url)),
        attempts:delivery_attempts(*)
      `,
      )
      .eq("id", orderId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle(),
  ]);

  if (error) return err("internal", "Failed to load the invoice", "errors.drive.invoice.loadFailed");
  if (!order) return err("not_found", "Order not found", "errors.drive.invoice.notFound");

  const attempts = ((order.attempts ?? []) as DeliveryAttempt[])
    .filter((attempt) => attempt.outcome === "delivered")
    .sort((a, b) => a.attempted_at.localeCompare(b.attempted_at));

  return ok({
    organizationName: org?.name ?? organizationSlug,
    order: order as OrderWithItems,
    deliveredAttempt: attempts.at(-1) ?? null,
  });
}
```

Import `DeliveryAttempt` from `../types` if not already imported. Check the actual column name for the attempt timestamp in `types.ts` (`attempted_at` is used by `lastAttempt` in `driver-run-model.ts` — keep consistent).

Run: `npx vitest run src/features/orders/tests/unit/driver-actions-message-keys.test.ts`
Expected: PASS.

- [ ] **Step 3: The page**

`src/app/[locale]/drive/[organizationSlug]/invoice/[orderId]/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { getDriverInvoice } from "@/features/orders/server/driver-actions";
import { formatPrice, formatWeight } from "@/features/orders/lib/order-model";
import { PrintButton } from "./print-button";

export default async function DriverInvoicePage({
  params,
}: {
  params: Promise<{ organizationSlug: string; orderId: string }>;
}) {
  const { organizationSlug, orderId } = await params;
  const [result, t, tRoot] = await Promise.all([
    getDriverInvoice(organizationSlug, orderId),
    getTranslations("drive.invoice"),
    getTranslations(),
  ]);

  if (!result.ok) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{t("cantOpenTitle")}</h1>
        {/* messageKey is a dynamic full path; typed t() only accepts literals. */}
        <p className="text-sm text-muted-foreground">{tRoot(result.messageKey as never)}</p>
      </main>
    );
  }

  const { organizationName, order, deliveredAttempt } = result.data;

  if (order.status !== "delivered" && order.status !== "closed") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{t("notDeliveredTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notDeliveredDescription")}</p>
      </main>
    );
  }

  const items = order.items.filter((item) => !item.is_cancelled);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{organizationName}</h1>
          <p className="text-sm text-muted-foreground">
            {t("invoiceNumber", { number: order.id.slice(0, 8).toUpperCase() })} · {order.delivery_date}
          </p>
        </div>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </div>

      <div className="rounded-xl border p-3 text-sm print:rounded-none print:border-0 print:p-0">
        <p className="font-medium">{order.customer?.name ?? "-"}</p>
        <p className="text-muted-foreground">{order.delivery_address}</p>
        {order.customer?.phone && <p className="text-muted-foreground">{order.customer.phone}</p>}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">{t("headers.item")}</th>
            <th className="p-2 text-right">{t("headers.weight")}</th>
            <th className="p-2 text-right">{t("headers.pricePerKg")}</th>
            <th className="p-2 text-right">{t("headers.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="p-2">
                {item.product?.name ?? t("itemFallback")}
                {item.final_pieces !== null ? ` · ${t("pieces", { count: item.final_pieces })}` : ""}
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.final_weight_kg !== null ? formatWeight(item.final_weight_kg) : "-"}
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.price_per_kg !== null ? formatPrice(item.price_per_kg) : "-"}
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.line_total !== null ? formatPrice(item.line_total) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="p-2 font-semibold" colSpan={3}>
              {t("grandTotal")}
            </td>
            <td className="p-2 text-right text-base font-bold tabular-nums">
              {formatPrice(order.total_amount ?? 0)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="text-xs text-muted-foreground">
        {deliveredAttempt && (
          <p>
            {t("deliveredAt", { time: new Date(deliveredAttempt.attempted_at).toLocaleString() })}
            {deliveredAttempt.received_by ? ` · ${t("receivedBy", { name: deliveredAttempt.received_by })}` : ""}
          </p>
        )}
        <p>{t("footerNote")}</p>
      </div>
    </div>
  );
}
```

Check `OrderItem` in `types.ts` for `line_total` (a generated column — confirm it is in the select `*` payload and typed; it is a real column in `database.generated.ts`). If `order.delivery_date` isn't the field name, use the date field the manifest/run pages use.

- [ ] **Step 4: i18n keys**

`en.json` — inside the existing top-level `"drive"` object (near line 1180) add:

```json
"invoice": {
  "cantOpenTitle": "Can't open this invoice",
  "notDeliveredTitle": "Not delivered yet",
  "notDeliveredDescription": "The invoice appears once the delivery is recorded.",
  "invoiceNumber": "Invoice #{number}",
  "headers": { "item": "Item", "weight": "Weight", "pricePerKg": "Price/kg", "lineTotal": "Total" },
  "itemFallback": "Item",
  "pieces": "{count} pcs",
  "grandTotal": "Grand total",
  "deliveredAt": "Delivered {time}",
  "receivedBy": "received by {name}",
  "footerNote": "Weighed at delivery. Thank you!"
}
```

`errors.drive` additions in both files:

```json
"invoice": {
  "loadFailed": "Failed to load the invoice.",
  "notFound": "Order not found."
}
```

`ms.json` `drive.invoice`:

```json
"invoice": {
  "cantOpenTitle": "Tidak dapat buka invois ini",
  "notDeliveredTitle": "Belum dihantar",
  "notDeliveredDescription": "Invois akan muncul selepas penghantaran direkodkan.",
  "invoiceNumber": "Invois #{number}",
  "headers": { "item": "Item", "weight": "Berat", "pricePerKg": "Harga/kg", "lineTotal": "Jumlah" },
  "itemFallback": "Item",
  "pieces": "{count} ekor",
  "grandTotal": "Jumlah besar",
  "deliveredAt": "Dihantar {time}",
  "receivedBy": "diterima oleh {name}",
  "footerNote": "Ditimbang semasa penghantaran. Terima kasih!"
}
```

`errors.drive.invoice` in ms.json:

```json
"invoice": {
  "loadFailed": "Gagal memuatkan invois.",
  "notFound": "Pesanan tidak dijumpai."
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run src/features/orders`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/drive/[organizationSlug]/invoice src/features/orders/server/driver-actions.ts src/features/orders/tests/unit/driver-actions-message-keys.test.ts src/messages/en.json src/messages/ms.json
git commit -m "feat(drive): per-order printable invoice"
```

---

### Task 6: E2E — driver starts run, weighs at door, invoice totals match

**Files:**
- Create: `e2e/driver-run.spec.ts`
- Read first: `e2e/_fixtures.ts` (org/user/order builders) and `e2e/order-pipeline.spec.ts` (how a run gets to planned with a ready order, and how roles/logins work — reuse its helpers; the spec was recently rekeyed to confirm-time pricing, so copy its order-confirm steps exactly)

**Interfaces:**
- Consumes: the full stack from Tasks 1–5.

- [ ] **Step 1: Write the spec**

Scenario (adapt setup calls to what `_fixtures.ts` actually provides — read it before writing):

```ts
// Pseudocode-free skeleton; fill fixture calls from _fixtures.ts.
test("driver starts run, keys weights, invoice shows recomputed total", async ({ page }) => {
  // 1. Seed: org, seller, driver member (role 'driver'), customer, order with
  //    one kg-mode item (quantity 2, price_per_kg 12 keyed at confirm),
  //    task completed (warehouse weigh) so status is 'ready', assigned to a
  //    truck+run for today, driver assigned to the run (dispatch_assign_driver).
  // 2. Log in as the driver, go to /drive/{orgSlug}.
  // 3. Expect "Start delivering" button; click it; expect the arrive button to appear.
  // 4. Tap arrive ("I'm at the door"), then "Delivered".
  // 5. In the sheet: fill the weight input with "2.35"; expect the live total
  //    to show 28.20 (2.35 × 12); confirm.
  // 6. Expect the delivered toast; open the whole-run list; click "Invoice".
  // 7. On the invoice page expect: item row with 2.35 kg, price 12, line total
  //    28.20, grand total 28.20.
});

test("confirm is blocked until every item has a weight", async ({ page }) => {
  // Same setup through step 4, but click confirm with the weight empty:
  // expect the confirm button disabled (or the weights-missing toast).
});
```

Use accessible selectors consistent with the other specs (`getByRole`, `getByPlaceholder`, `getByText` with the en.json strings added in Tasks 4–5). Assert money via the same formatting the app renders (check `formatPrice` output format in an existing spec before hardcoding "RM 28.20" vs "28.20").

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/driver-run.spec.ts`
Expected: PASS. (Needs local supabase + dev server per the repo's playwright config — the other specs' setup applies.)

- [ ] **Step 3: Full suite sanity**

Run: `npm run typecheck && npm run lint && npx vitest run && npx playwright test e2e/order-pipeline.spec.ts e2e/driver-run.spec.ts`
Expected: PASS — order-pipeline must still pass because `driver_deliver_stop`'s signature changed; if it calls the old flow through the UI it is unaffected, but if it stubs the RPC directly, update it to the 6-arg form.

- [ ] **Step 4: Commit**

```bash
git add e2e/driver-run.spec.ts
git commit -m "test(e2e): driver run flow — start, door weights, invoice"
```
