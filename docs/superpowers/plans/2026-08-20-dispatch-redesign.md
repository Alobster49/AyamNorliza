# Dispatch Redesign (Auto-Plan Deck + Loader + Day Timeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single dispatch board with three surfaces: an Auto-Plan Deck (rules draft the day's assignments, dispatcher approves), a Day Timeline (trucks × time with risk states), and a phone-first Loader screen (worker confirms each order onto the truck).

**Architecture:** All three surfaces read the existing `DispatchBoardData` from `getDispatchBoard`. New pure view-models (`plan-model.ts`, `timeline-model.ts`, `loading-model.ts`) live beside `dispatch-board-model.ts` and are unit-tested with vitest. One DB migration adds `orders.loaded_at/loaded_by`, `trucks.capacity_kg`, and RPC `dispatch_set_loaded`. The `/dispatch` page gets a view switcher (Plan | Timeline | Board) with board state lifted into a new `DispatchClient`; the Loader is a new `/loading` route.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 + shadcn tokens, Supabase (Postgres RPCs, plpgsql), dnd-kit (existing board only), vitest.

## Global Constraints

- Working tree has UNRELATED uncommitted changes (weigh-station feature: `src/app/(seller)/[organizationSlug]/tasks/tasks-client.tsx`, `src/features/orders/components/*`, `src/features/dashboard/components/app-sidebar.tsx`, others in `git status`). NEVER `git add -A`. Stage only the exact paths named in each task's commit step.
- DB row types mirror the DB in snake_case (see `src/features/logistics/types.ts` header comment).
- Pure view logic goes in `src/features/logistics/lib/*` with tests in `src/features/logistics/tests/unit/*`; components never compute in render what a model can precompute.
- RPCs follow the style of `supabase/migrations/20260814000001_logistics_dispatch_schema.sql`: `security definer`, `set search_path = public, pg_temp`, `raise exception using errcode = 'P0001', message = '<code>'`, `revoke all … from public; grant execute … to authenticated`.
- Server action errors go through the existing `mapRpcError` in `dispatch-actions.ts`.
- Test command: `npx vitest run <file>` (full suite: `npm test`).
- UI: Tailwind classes with shadcn tokens (`bg-card`, `text-muted-foreground`, `border`, `bg-primary`, `bg-accent`, `bg-destructive`…). No new npm dependencies. Touch targets on the Loader ≥ 44px (`min-h-11` or larger). All animation classes get `motion-reduce:transition-none`.
- Dispatch role guard everywhere: `requireOrgRole(organizationSlug, DISPATCH_ROLES)` (see `src/features/logistics/lib/roles.ts`).
- UI copy in English, sentence case, no jargon ("Accept 15", "Loaded", "On the road").

---

### Task 1: Migration + types + board query weights

**Files:**
- Create: `supabase/migrations/20260820000001_dispatch_loading.sql`
- Modify: `src/features/orders/types.ts` (Order, Truck types)
- Modify: `src/features/logistics/types.ts` (DispatchTicket)
- Modify: `src/features/logistics/server/dispatch-actions.ts` (orders select in `getDispatchBoard`, ~line 88)

**Interfaces:**
- Produces: `Order.loaded_at: string | null`, `Order.loaded_by: string | null`, `Truck.capacity_kg: number | null`, `TicketItem` type, `DispatchTicket.items?: TicketItem[]`, RPC `dispatch_set_loaded(p_order uuid, p_loaded boolean)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260820000001_dispatch_loading.sql`:

```sql
-- Dispatch redesign: loading confirmation + optional kg capacity.
-- loaded_at/loaded_by mark an order physically confirmed onto its truck by
-- a loader; capacity_kg lets the plan deck show weight-based utilization.

alter table public.orders
  add column if not exists loaded_at timestamptz,
  add column if not exists loaded_by uuid references auth.users (id) on delete set null;

alter table public.trucks
  add column if not exists capacity_kg numeric(7, 2)
    constraint trucks_capacity_kg_positive check (capacity_kg is null or capacity_kg > 0);

-- ---------------------------------------------------------------------------
-- dispatch_set_loaded: loader confirms (or un-confirms) an order onto its
-- assigned truck. Mirrors dispatch_assign_order's guard style.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_set_loaded(p_order uuid, p_loaded boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
begin
  select organization_id, status, run_id
  into v_org, v_status, v_run
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  update public.orders
  set loaded_at = case when p_loaded then now() else null end,
      loaded_by = case when p_loaded then auth.uid() else null end
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_set_loaded(uuid, boolean) from public;
grant execute on function public.dispatch_set_loaded(uuid, boolean) to authenticated;
```

Before finalizing, confirm the `has_org_role` call signature matches the one used at `supabase/migrations/20260814000001_logistics_dispatch_schema.sql:246` (it does: `has_org_role(v_org, array[...])`) and that enum type names `public.order_status` / `public.delivery_run_status` exist in that same migration or `20260810000001` (grep them; adjust names only if grep shows different).

- [ ] **Step 2: Apply migration locally if the Supabase stack is running**

Run: `npx supabase migration up 2>/dev/null || echo "supabase stack not running — skip, migration will apply on next db reset"`
Expected: either applied cleanly or the skip message. Do not start the stack just for this.

- [ ] **Step 3: Extend the Order and Truck types**

In `src/features/orders/types.ts`, inside `export type Order = {` add after `closed_at: string | null;`:

```ts
  loaded_at: string | null;
  loaded_by: string | null;
```

Inside `export type Truck = {` add after `bay_id: string | null;`:

```ts
  capacity_kg: number | null;
```

- [ ] **Step 4: Add TicketItem to logistics types**

In `src/features/logistics/types.ts`, replace the `DispatchTicket` definition with:

```ts
export type TicketItem = {
  quantity: number;
  warehouse_weight_kg: number | null;
  warehouse_pieces: number | null;
  final_weight_kg: number | null;
  is_cancelled: boolean;
  product?: { name: string } | null;
};

export type DispatchTicket = Order & {
  customer?: { name: string };
  zone?: { name: string };
  item_count?: number;
  items?: TicketItem[];
};
```

- [ ] **Step 5: Fetch items in getDispatchBoard**

In `src/features/logistics/server/dispatch-actions.ts`, in the `orders` query inside `getDispatchBoard`, change the select from
`"*, customer:customers(name), zone:delivery_zones(name)"` to:

```ts
"*, customer:customers(name), zone:delivery_zones(name), items:order_items(quantity, warehouse_weight_kg, warehouse_pieces, final_weight_kg, is_cancelled, product:products(name))"
```

- [ ] **Step 6: Typecheck + run existing suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. If any test fixture now fails to satisfy `Order` (missing `loaded_at`/`loaded_by`) or `Truck` (missing `capacity_kg`), add the new fields (`loaded_at: null, loaded_by: null` / `capacity_kg: null`) to those fixtures — likely candidates: `src/features/logistics/tests/unit/*.test.ts`, `src/features/orders/tests/unit/*.test.ts`, `src/features/dashboard/tests/unit/*`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260820000001_dispatch_loading.sql src/features/orders/types.ts src/features/logistics/types.ts src/features/logistics/server/dispatch-actions.ts
git add -u src/features/logistics/tests src/features/orders/tests
git commit -m "feat(dispatch): loaded state, kg capacity, item weights on board query"
```

(Only add the tests dirs if fixtures changed; check `git status` first and never stage unrelated files from the Global Constraints list.)

---

### Task 2: plan-model (pure auto-plan draft)

**Files:**
- Create: `src/features/logistics/lib/plan-model.ts`
- Test: `src/features/logistics/tests/unit/plan-model.test.ts`

**Interfaces:**
- Consumes: `suggestTruck`, `AssignmentContext` from `../lib/assignment`; `DispatchBoardData`, `DispatchTicket` from `../types`.
- Produces:
  - `orderWeightKg(ticket: DispatchTicket): number | null`
  - `totalWeightKg(tickets: DispatchTicket[]): number`
  - `draftPlan(data: DispatchBoardData, date: string): PlanDraft` where `PlanDraft = { proposals: PlanProposal[]; exceptions: PlanException[]; poolCount: number }`, `PlanProposal = { orderId: string; truckId: string; zoneId: string; reason: string }`, `PlanException = { orderId: string; kind: "no_postcode" | "no_zone_match" | "no_covering_truck" | "all_trucks_full"; detail: string }`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/logistics/tests/unit/plan-model.test.ts`. Look at `src/features/logistics/tests/unit/dispatch-board-model.test.ts` first — if it exports or inlines fixture factories for trucks/orders/slots, copy that shape. Otherwise use these factories verbatim (adjust only field lists to satisfy the types):

```ts
import { describe, expect, it } from "vitest";
import type { DispatchBoardData, DispatchTicket } from "../../types";
import { draftPlan, orderWeightKg, totalWeightKg } from "../../lib/plan-model";

const DATE = "2026-08-20"; // a Thursday? verify: new Date(2026,7,20).getDay() — use whatever weekday the slots below use
const WEEKDAY = new Date(2026, 7, 20).getDay();

let n = 0;
const uid = (p: string) => `${p}-${++n}`.padEnd(36, "0");

function truck(over: Partial<DispatchBoardData["trucks"][number]> = {}) {
  return {
    id: uid("truck"), organization_id: "org", name: "Lori", code: "T1",
    is_active: true, bay_id: "bay-1", capacity_kg: null,
    created_by: null, created_at: "", updated_at: "", version: 1, ...over,
  };
}

function order(over: Partial<DispatchTicket> = {}): DispatchTicket {
  return {
    id: uid("order"), organization_id: "org", customer_id: "c", created_by: null,
    source: "manual", status: "confirmed", zone_id: "zone-1",
    delivery_address: "addr", delivery_date: DATE, slot_id: "slot-1",
    truck_id: "truck-x", run_id: null, postcode: "82000",
    assignment_source: "none", notes: null, total_amount: 0, closed_at: null,
    loaded_at: null, loaded_by: null,
    created_at: "", updated_at: "", version: 1,
    customer: { name: "Kedai A" }, ...over,
  };
}

function baseData(over: Partial<DispatchBoardData> = {}): DispatchBoardData {
  const t = truck({ id: "truck-1".padEnd(36, "0") });
  return {
    facility: null,
    bays: [{ id: "bay-1", organization_id: "org", facility_id: "f", name: "Bay A", position: 0, is_active: true, created_by: null, created_at: "", updated_at: "", version: 1 }],
    trucks: [t],
    zones: [{ id: "zone-1", organization_id: "org", name: "Zone 1", description: null, is_active: true, created_by: null, created_at: "", updated_at: "", version: 1 } as DispatchBoardData["zones"][number]],
    ranges: [{ id: "r1", organization_id: "org", zone_id: "zone-1", postcode_start: "82000", postcode_end: "82999", created_by: null, created_at: "" }],
    truckZones: [{ truck_id: t.id, zone_id: "zone-1" } as DispatchBoardData["truckZones"][number]],
    slots: [{ id: "slot-1", organization_id: "org", truck_id: t.id, weekday: WEEKDAY, start_time: "08:00:00", end_time: "09:00:00", max_orders: 10, is_active: true, created_by: null, created_at: "", updated_at: "", version: 1 } as DispatchBoardData["slots"][number]],
    blocks: [],
    runs: [],
    orders: [],
    ...over,
  };
}
```

> The `zones`/`truckZones`/`slots` casts exist because those row types live in `@/features/orders/types`; if the literal shape mismatches, open that file and match the exact fields instead of casting.

Tests:

```ts
describe("draftPlan", () => {
  it("proposes a covering truck for a pool order, with a readable reason", () => {
    const data = baseData();
    data.orders = [order()];
    const draft = draftPlan(data, DATE);
    expect(draft.exceptions).toEqual([]);
    expect(draft.proposals).toHaveLength(1);
    expect(draft.proposals[0]!.truckId).toBe(data.trucks[0]!.id);
    expect(draft.proposals[0]!.reason).toContain("Zone 1");
  });

  it("counts its own proposals toward load, so a cap-1 slot only takes one order", () => {
    const data = baseData();
    data.slots = [{ ...data.slots[0]!, max_orders: 1 }];
    data.orders = [order(), order()];
    const draft = draftPlan(data, DATE);
    expect(draft.proposals).toHaveLength(1);
    expect(draft.exceptions).toHaveLength(1);
    expect(draft.exceptions[0]!.kind).toBe("all_trucks_full");
  });

  it("reports a no_postcode exception with a human detail", () => {
    const data = baseData();
    data.orders = [order({ postcode: null })];
    const draft = draftPlan(data, DATE);
    expect(draft.exceptions[0]!.kind).toBe("no_postcode");
    expect(draft.exceptions[0]!.detail.length).toBeGreaterThan(0);
  });

  it("ignores already-assigned orders but counts them as load", () => {
    const data = baseData();
    data.slots = [{ ...data.slots[0]!, max_orders: 1 }];
    data.orders = [
      order({ assignment_source: "manual", truck_id: data.trucks[0]!.id }),
      order(),
    ];
    const draft = draftPlan(data, DATE);
    expect(draft.poolCount).toBe(1);
    expect(draft.proposals).toHaveLength(0);
    expect(draft.exceptions[0]!.kind).toBe("all_trucks_full");
  });
});

describe("orderWeightKg", () => {
  it("returns null with no recorded weights", () => {
    expect(orderWeightKg(order({ items: [{ quantity: 2, warehouse_weight_kg: null, warehouse_pieces: null, final_weight_kg: null, is_cancelled: false }] }))).toBeNull();
  });

  it("prefers final weight over warehouse weight and skips cancelled lines", () => {
    const t = order({
      items: [
        { quantity: 1, warehouse_weight_kg: 10, warehouse_pieces: null, final_weight_kg: 12, is_cancelled: false },
        { quantity: 1, warehouse_weight_kg: 5, warehouse_pieces: null, final_weight_kg: null, is_cancelled: false },
        { quantity: 1, warehouse_weight_kg: 99, warehouse_pieces: null, final_weight_kg: null, is_cancelled: true },
      ],
    });
    expect(orderWeightKg(t)).toBe(17);
    expect(totalWeightKg([t, t])).toBe(34);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/logistics/tests/unit/plan-model.test.ts`
Expected: FAIL — cannot resolve `../../lib/plan-model`.

- [ ] **Step 3: Implement plan-model**

Create `src/features/logistics/lib/plan-model.ts`:

```ts
/**
 * Pure auto-plan draft for the dispatch deck. Reuses suggestTruck (the
 * same rules the per-order auto-assign uses) across the whole pool,
 * incrementing a working load count so proposals respect slot caps
 * against each other, not just against what's already assigned.
 */

import type { DispatchBoardData, DispatchTicket } from "../types";
import { suggestTruck, type AssignmentContext, type AssignmentResult } from "./assignment";

export type PlanProposal = { orderId: string; truckId: string; zoneId: string; reason: string };
export type ExceptionKind = Extract<AssignmentResult, { ok: false }>["reason"];
export type PlanException = { orderId: string; kind: ExceptionKind; detail: string };
export type PlanDraft = { proposals: PlanProposal[]; exceptions: PlanException[]; poolCount: number };

const EXCEPTION_DETAIL: Record<ExceptionKind, string> = {
  no_postcode: "Order has no postcode — add one on the order first.",
  no_zone_match: "No delivery zone covers this postcode.",
  no_covering_truck: "No truck covers this zone today.",
  all_trucks_full: "Every covering truck is at its slot capacity.",
};

/** Sum of recorded line weights (final wins over warehouse); null when nothing is weighed yet. */
export function orderWeightKg(ticket: DispatchTicket): number | null {
  const weights = (ticket.items ?? [])
    .filter((i) => !i.is_cancelled)
    .map((i) => i.final_weight_kg ?? i.warehouse_weight_kg)
    .filter((w): w is number => w !== null);
  if (weights.length === 0) return null;
  return weights.reduce((a, b) => a + b, 0);
}

export function totalWeightKg(tickets: DispatchTicket[]): number {
  return tickets.reduce((sum, t) => sum + (orderWeightKg(t) ?? 0), 0);
}

export function draftPlan(data: DispatchBoardData, date: string): PlanDraft {
  const slotStartById = new Map(data.slots.map((s) => [s.id, s.start_time]));
  const zoneNameById = new Map(data.zones.map((z) => [z.id, z.name]));

  const loads: Record<string, number> = {};
  for (const o of data.orders) {
    if (o.assignment_source !== "none") loads[o.truck_id] = (loads[o.truck_id] ?? 0) + 1;
  }
  const ctx: AssignmentContext = {
    zones: data.zones,
    ranges: data.ranges,
    truckZones: data.truckZones,
    trucks: data.trucks,
    slots: data.slots,
    blocks: data.blocks,
    loads,
  };

  const pool = data.orders
    .filter((o) => o.assignment_source === "none")
    .sort((a, b) => (slotStartById.get(a.slot_id) ?? "").localeCompare(slotStartById.get(b.slot_id) ?? ""));

  const proposals: PlanProposal[] = [];
  const exceptions: PlanException[] = [];
  for (const o of pool) {
    const result = suggestTruck(
      { postcode: o.postcode, delivery_date: date, slot_start_time: slotStartById.get(o.slot_id) ?? null },
      ctx,
    );
    if (result.ok) {
      ctx.loads[result.truckId] = (ctx.loads[result.truckId] ?? 0) + 1;
      const slot = slotStartById.get(o.slot_id);
      proposals.push({
        orderId: o.id,
        truckId: result.truckId,
        zoneId: result.zoneId,
        reason: [zoneNameById.get(result.zoneId), slot ? `slot ${slot.slice(0, 5)}` : null, "least loaded"]
          .filter(Boolean)
          .join(" · "),
      });
    } else {
      exceptions.push({ orderId: o.id, kind: result.reason, detail: EXCEPTION_DETAIL[result.reason] });
    }
  }
  return { proposals, exceptions, poolCount: pool.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/logistics/tests/unit/plan-model.test.ts`
Expected: PASS (fix fixture field mismatches against the real types if TS complains — never loosen the model to fit the fixture).

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/plan-model.ts src/features/logistics/tests/unit/plan-model.test.ts
git commit -m "feat(dispatch): pure auto-plan draft model with weights"
```

---

### Task 3: timeline-model (pure day timeline)

**Files:**
- Create: `src/features/logistics/lib/timeline-model.ts`
- Test: `src/features/logistics/tests/unit/timeline-model.test.ts`

**Interfaces:**
- Consumes: `buildBoardView` from `./dispatch-board-model`; `orderWeightKg`, `totalWeightKg` from `./plan-model`.
- Produces:
  - `minutesOf(time: string): number` — `"08:30:00" → 510`
  - `buildTimeline(data: DispatchBoardData, date: string, nowMinutes: number | null): TimelineView`
  - `TimelineView = { rows: TimelineRow[]; hours: number[]; windowStart: number; windowEnd: number; nowPct: number | null; poolCount: number }`
  - `TimelineRow = { truck: DispatchTruck; departed: boolean; blocks: TimelineBlock[]; loadKg: number }`
  - `TimelineBlock = { ticket: DispatchTicket; startMin: number; endMin: number; startPct: number; widthPct: number; state: "ready" | "pending" | "atRisk" | "late" | "departed" }`

- [ ] **Step 1: Write the failing tests**

Create `src/features/logistics/tests/unit/timeline-model.test.ts`. Reuse the fixture factories from `plan-model.test.ts` by copying them (tests stay standalone; do NOT import from another test file). For orders that should appear on a truck, use `order({ assignment_source: "auto", truck_id: <truckId> })`.

```ts
import { describe, expect, it } from "vitest";
import { buildTimeline, minutesOf } from "../../lib/timeline-model";
// ...same DATE, WEEKDAY, uid, truck, order, baseData factories as plan-model.test.ts

describe("minutesOf", () => {
  it("parses HH:MM:SS to minutes", () => {
    expect(minutesOf("08:30:00")).toBe(510);
    expect(minutesOf("06:00")).toBe(360);
  });
});

describe("buildTimeline", () => {
  it("places an assigned order as a block positioned inside the hour window", () => {
    const data = baseData();
    const truckId = data.trucks[0]!.id;
    data.orders = [order({ assignment_source: "auto", truck_id: truckId, status: "ready" })];
    const view = buildTimeline(data, DATE, null);
    expect(view.rows).toHaveLength(1);
    const block = view.rows[0]!.blocks[0]!;
    expect(block.state).toBe("ready");
    expect(block.startPct).toBeGreaterThanOrEqual(0);
    expect(block.widthPct).toBeGreaterThan(0);
    // slot 08:00-09:00 with default padding window still contains it fully
    expect(block.startPct + block.widthPct).toBeLessThanOrEqual(100);
  });

  it("derives late and atRisk from now for unready orders", () => {
    const data = baseData();
    const truckId = data.trucks[0]!.id;
    data.orders = [order({ assignment_source: "auto", truck_id: truckId, status: "confirmed" })];
    // slot starts 08:00 (480). At 09:00 it's late; at 07:30 it's at risk.
    expect(buildTimeline(data, DATE, 540).rows[0]!.blocks[0]!.state).toBe("late");
    expect(buildTimeline(data, DATE, 450).rows[0]!.blocks[0]!.state).toBe("atRisk");
    expect(buildTimeline(data, DATE, 300).rows[0]!.blocks[0]!.state).toBe("pending");
  });

  it("marks blocks departed when the truck's run has departed", () => {
    const data = baseData();
    const truckId = data.trucks[0]!.id;
    data.runs = [{ id: "run-1", organization_id: "org", truck_id: truckId, run_date: DATE, status: "departed", notes: null, created_at: "", updated_at: "", version: 1 }];
    data.orders = [order({ assignment_source: "auto", truck_id: truckId, status: "ready", run_id: "run-1" })];
    const view = buildTimeline(data, DATE, 540);
    expect(view.rows[0]!.departed).toBe(true);
    expect(view.rows[0]!.blocks[0]!.state).toBe("departed");
  });

  it("computes nowPct only when now falls inside the window", () => {
    const data = baseData();
    data.orders = [order({ assignment_source: "auto", truck_id: data.trucks[0]!.id })];
    expect(buildTimeline(data, DATE, 480).nowPct).not.toBeNull();
    expect(buildTimeline(data, DATE, 1400).nowPct).toBeNull();
    expect(buildTimeline(data, DATE, null).nowPct).toBeNull();
  });

  it("falls back to a 06:00-14:00 window when nothing is scheduled", () => {
    const view = buildTimeline(baseData(), DATE, null);
    expect(view.windowStart).toBe(360);
    expect(view.windowEnd).toBe(840);
    expect(view.hours[0]).toBe(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/logistics/tests/unit/timeline-model.test.ts`
Expected: FAIL — cannot resolve `../../lib/timeline-model`.

- [ ] **Step 3: Implement timeline-model**

Create `src/features/logistics/lib/timeline-model.ts`:

```ts
/**
 * Pure day-timeline view: trucks as rows, the day as an hour axis, each
 * assigned order as a block at its delivery slot. Risk is derived, never
 * stored: an unready order whose slot start is near (or past) "now" turns
 * amber (atRisk) or red (late). nowMinutes is injected for testability;
 * the client passes local minutes for today and null for other dates.
 */

import type { DispatchBoardData, DispatchTicket, DispatchTruck } from "../types";
import { buildBoardView } from "./dispatch-board-model";
import { totalWeightKg } from "./plan-model";

export type BlockState = "ready" | "pending" | "atRisk" | "late" | "departed";

export type TimelineBlock = {
  ticket: DispatchTicket;
  startMin: number;
  endMin: number;
  startPct: number;
  widthPct: number;
  state: BlockState;
};

export type TimelineRow = {
  truck: DispatchTruck;
  departed: boolean;
  blocks: TimelineBlock[];
  loadKg: number;
};

export type TimelineView = {
  rows: TimelineRow[];
  hours: number[];
  windowStart: number;
  windowEnd: number;
  nowPct: number | null;
  poolCount: number;
};

const AT_RISK_LEAD_MIN = 60;
const DEFAULT_START = 6 * 60;
const DEFAULT_END = 14 * 60;

export function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

function blockState(ticket: DispatchTicket, departed: boolean, startMin: number, nowMinutes: number | null): BlockState {
  if (departed) return "departed";
  if (ticket.status === "ready") return "ready";
  if (nowMinutes !== null) {
    if (startMin <= nowMinutes) return "late";
    if (startMin - nowMinutes <= AT_RISK_LEAD_MIN) return "atRisk";
  }
  return "pending";
}

export function buildTimeline(
  data: DispatchBoardData,
  date: string,
  nowMinutes: number | null,
): TimelineView {
  const board = buildBoardView(data, date);
  const slotById = new Map(data.slots.map((s) => [s.id, s]));
  const boardTrucks = board.bays.flatMap((b) => b.trucks);

  // Window from every scheduled block, padded to whole hours.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const bt of boardTrucks) {
    for (const t of bt.tickets) {
      const slot = slotById.get(t.slot_id);
      if (!slot) continue;
      min = Math.min(min, minutesOf(slot.start_time));
      max = Math.max(max, minutesOf(slot.end_time));
    }
  }
  const windowStart = Number.isFinite(min) ? Math.floor(min / 60) * 60 : DEFAULT_START;
  const windowEnd = Number.isFinite(max) ? Math.max(Math.ceil(max / 60) * 60, windowStart + 120) : DEFAULT_END;
  const span = windowEnd - windowStart;

  const rows: TimelineRow[] = boardTrucks.map((bt) => ({
    truck: bt.truck,
    departed: bt.departed,
    loadKg: totalWeightKg(bt.tickets),
    blocks: bt.tickets.flatMap((ticket) => {
      const slot = slotById.get(ticket.slot_id);
      if (!slot) return [];
      const startMin = minutesOf(slot.start_time);
      const endMin = Math.max(minutesOf(slot.end_time), startMin + 15);
      return [{
        ticket,
        startMin,
        endMin,
        startPct: ((startMin - windowStart) / span) * 100,
        widthPct: ((endMin - startMin) / span) * 100,
        state: blockState(ticket, bt.departed, startMin, nowMinutes),
      }];
    }),
  }));

  const hours: number[] = [];
  for (let h = windowStart / 60; h <= windowEnd / 60; h++) hours.push(h);

  const nowPct =
    nowMinutes !== null && nowMinutes >= windowStart && nowMinutes <= windowEnd
      ? ((nowMinutes - windowStart) / span) * 100
      : null;

  return { rows, hours, windowStart, windowEnd, nowPct, poolCount: board.pool.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/logistics/tests/unit/timeline-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/timeline-model.ts src/features/logistics/tests/unit/timeline-model.test.ts
git commit -m "feat(dispatch): pure day-timeline model with derived risk states"
```

---

### Task 4: loading-model (pure loader queue)

**Files:**
- Create: `src/features/logistics/lib/loading-model.ts`
- Test: `src/features/logistics/tests/unit/loading-model.test.ts`

**Interfaces:**
- Consumes: `buildBoardView` from `./dispatch-board-model`; `orderWeightKg`, `totalWeightKg` from `./plan-model`.
- Produces:
  - `buildLoadQueue(data: DispatchBoardData, date: string, truckId: string): LoadQueue | null`
  - `LoadQueue = { truck: DispatchTruck; departed: boolean; jobs: LoadJob[]; doneCount: number; totalCount: number; totalKg: number; loadedKg: number }`
  - `LoadJob = { ticket: DispatchTicket; lines: LoadLine[]; weightKg: number | null; loaded: boolean; slotStart: string | null }`
  - `LoadLine = { name: string; quantity: number; pieces: number | null; weightKg: number | null }`
  - `truckSummaries(data: DispatchBoardData, date: string): LoadTruckSummary[]` where `LoadTruckSummary = { truck: DispatchTruck; bayName: string; departed: boolean; doneCount: number; totalCount: number; totalKg: number }` (for the truck picker).

- [ ] **Step 1: Write the failing tests**

Create `src/features/logistics/tests/unit/loading-model.test.ts` (copy the same fixture factories again):

```ts
import { describe, expect, it } from "vitest";
import { buildLoadQueue, truckSummaries } from "../../lib/loading-model";
// ...same factories

describe("buildLoadQueue", () => {
  it("returns null for a truck that is not on the board", () => {
    expect(buildLoadQueue(baseData(), DATE, "nope")).toBeNull();
  });

  it("builds jobs with product lines, weight, and slot start", () => {
    const data = baseData();
    const truckId = data.trucks[0]!.id;
    data.orders = [order({
      assignment_source: "auto", truck_id: truckId, status: "ready",
      items: [
        { quantity: 12, warehouse_weight_kg: 16.8, warehouse_pieces: 12, final_weight_kg: null, is_cancelled: false, product: { name: "Ayam standard" } },
        { quantity: 2, warehouse_weight_kg: 3, warehouse_pieces: 2, final_weight_kg: null, is_cancelled: true, product: { name: "Hati" } },
      ],
    })];
    const q = buildLoadQueue(data, DATE, truckId)!;
    expect(q.jobs).toHaveLength(1);
    expect(q.jobs[0]!.lines).toHaveLength(1); // cancelled line dropped
    expect(q.jobs[0]!.lines[0]!.name).toBe("Ayam standard");
    expect(q.jobs[0]!.weightKg).toBe(16.8);
    expect(q.jobs[0]!.slotStart).toBe("08:00");
    expect(q.totalKg).toBe(16.8);
    expect(q.loadedKg).toBe(0);
  });

  it("sorts unloaded jobs first and counts done", () => {
    const data = baseData();
    const truckId = data.trucks[0]!.id;
    const loaded = order({ assignment_source: "auto", truck_id: truckId, loaded_at: "2026-08-20T00:00:00Z" });
    const pending = order({ assignment_source: "auto", truck_id: truckId });
    data.orders = [loaded, pending];
    const q = buildLoadQueue(data, DATE, truckId)!;
    expect(q.jobs[0]!.loaded).toBe(false);
    expect(q.jobs[1]!.loaded).toBe(true);
    expect(q.doneCount).toBe(1);
    expect(q.totalCount).toBe(2);
  });
});

describe("truckSummaries", () => {
  it("summarizes each on-board truck with bay name and progress", () => {
    const data = baseData();
    data.orders = [order({ assignment_source: "auto", truck_id: data.trucks[0]!.id, loaded_at: "2026-08-20T00:00:00Z" })];
    const sums = truckSummaries(data, DATE);
    expect(sums).toHaveLength(1);
    expect(sums[0]!.bayName).toBe("Bay A");
    expect(sums[0]!.doneCount).toBe(1);
    expect(sums[0]!.totalCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/logistics/tests/unit/loading-model.test.ts`
Expected: FAIL — cannot resolve `../../lib/loading-model`.

- [ ] **Step 3: Implement loading-model**

Create `src/features/logistics/lib/loading-model.ts`:

```ts
/**
 * Pure loader-queue view: the orders assigned to one truck, as jobs a
 * loader confirms one by one at the bay door. Unloaded jobs come first
 * (by slot, then customer); loaded jobs sink to the bottom as receipts.
 */

import type { DispatchBoardData, DispatchTicket, DispatchTruck } from "../types";
import { buildBoardView } from "./dispatch-board-model";
import { orderWeightKg, totalWeightKg } from "./plan-model";

export type LoadLine = { name: string; quantity: number; pieces: number | null; weightKg: number | null };

export type LoadJob = {
  ticket: DispatchTicket;
  lines: LoadLine[];
  weightKg: number | null;
  loaded: boolean;
  slotStart: string | null;
};

export type LoadQueue = {
  truck: DispatchTruck;
  departed: boolean;
  jobs: LoadJob[];
  doneCount: number;
  totalCount: number;
  totalKg: number;
  loadedKg: number;
};

export type LoadTruckSummary = {
  truck: DispatchTruck;
  bayName: string;
  departed: boolean;
  doneCount: number;
  totalCount: number;
  totalKg: number;
};

function toJob(ticket: DispatchTicket, slotStartById: Map<string, string>): LoadJob {
  return {
    ticket,
    lines: (ticket.items ?? [])
      .filter((i) => !i.is_cancelled)
      .map((i) => ({
        name: i.product?.name ?? "Item",
        quantity: i.quantity,
        pieces: i.warehouse_pieces,
        weightKg: i.final_weight_kg ?? i.warehouse_weight_kg,
      })),
    weightKg: orderWeightKg(ticket),
    loaded: ticket.loaded_at !== null,
    slotStart: slotStartById.get(ticket.slot_id)?.slice(0, 5) ?? null,
  };
}

export function buildLoadQueue(
  data: DispatchBoardData,
  date: string,
  truckId: string,
): LoadQueue | null {
  const board = buildBoardView(data, date);
  const bt = board.bays.flatMap((b) => b.trucks).find((t) => t.truck.id === truckId);
  if (!bt) return null;

  const slotStartById = new Map(data.slots.map((s) => [s.id, s.start_time]));
  const jobs = bt.tickets.map((t) => toJob(t, slotStartById));
  jobs.sort(
    (a, b) =>
      Number(a.loaded) - Number(b.loaded) ||
      (a.slotStart ?? "").localeCompare(b.slotStart ?? "") ||
      (a.ticket.customer?.name ?? "").localeCompare(b.ticket.customer?.name ?? ""),
  );

  const done = jobs.filter((j) => j.loaded);
  return {
    truck: bt.truck,
    departed: bt.departed,
    jobs,
    doneCount: done.length,
    totalCount: jobs.length,
    totalKg: totalWeightKg(bt.tickets),
    loadedKg: totalWeightKg(done.map((j) => j.ticket)),
  };
}

export function truckSummaries(data: DispatchBoardData, date: string): LoadTruckSummary[] {
  const board = buildBoardView(data, date);
  return board.bays.flatMap((bay) =>
    bay.trucks.map((bt) => ({
      truck: bt.truck,
      bayName: bay.bay.name,
      departed: bt.departed,
      doneCount: bt.tickets.filter((t) => t.loaded_at !== null).length,
      totalCount: bt.tickets.length,
      totalKg: totalWeightKg(bt.tickets),
    })),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/logistics/tests/unit/loading-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/loading-model.ts src/features/logistics/tests/unit/loading-model.test.ts
git commit -m "feat(dispatch): pure loader-queue model"
```

---

### Task 5: server actions applyPlan + setOrderLoaded

**Files:**
- Modify: `src/features/logistics/server/dispatch-actions.ts` (append after `departTruck`)
- Test: `src/features/logistics/tests/unit/dispatch-actions.test.ts` (extend)

**Interfaces:**
- Consumes: RPCs `dispatch_assign_order` (existing), `dispatch_set_loaded` (Task 1); `guardDispatch`, `mapRpcError`, `err`, `ok` (existing in file).
- Produces:
  - `applyPlan(organizationSlug: string, rawInput: unknown): Promise<ActionResult<{ applied: number; failed: { orderId: string; message: string }[] }>>` — input `{ assignments: { orderId: uuid, truckId: uuid }[] }` (1–200).
  - `setOrderLoaded(organizationSlug: string, rawInput: unknown): Promise<ActionResult<void>>` — input `{ orderId: uuid, loaded: boolean }`.

- [ ] **Step 1: Read the existing action test harness**

Open `src/features/logistics/tests/unit/dispatch-actions.test.ts` and note how it mocks `createSupabaseServerClient`, `requireOrgRole`, and `revalidatePath` (vi.mock at module level). New tests MUST reuse that exact harness — same mock factories, same reset pattern.

- [ ] **Step 2: Write the failing tests**

Extend the file with two describes, mirroring existing test style. Behaviors to assert (write real assertions in the harness's idiom):

```ts
describe("applyPlan", () => {
  it("rejects a malformed payload with a validation error", async () => {
    // guard mocked ok; call applyPlan("org", { assignments: [] })
    // expect result.ok === false && result.code === "validation"
  });

  it("applies each assignment via dispatch_assign_order with p_source auto and counts failures per order", async () => {
    // rpc mock: first call resolves { error: null }, second { error: { message: "invalid_status" } }
    // call with two assignments
    // expect ok, data.applied === 1, data.failed[0].message to contain "confirmed or ready"
    // expect rpc called with { p_order, p_truck, p_source: "auto" }
  });
});

describe("setOrderLoaded", () => {
  it("calls dispatch_set_loaded with the parsed flags", async () => {
    // rpc mock resolves { error: null }; expect ok and rpc args { p_order, p_loaded: true }
  });

  it("maps run_departed rpc errors to a conflict", async () => {
    // rpc mock resolves { error: { message: "run_departed" } }
    // expect result.code === "conflict"
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-actions.test.ts`
Expected: FAIL — `applyPlan` / `setOrderLoaded` not exported.

- [ ] **Step 4: Implement the actions**

Append to `src/features/logistics/server/dispatch-actions.ts`:

```ts
// ---------------------------------------------------------------------------
// Plan apply (auto-plan deck) + loading confirmation
// ---------------------------------------------------------------------------

const ApplyPlanSchema = z.object({
  assignments: z
    .array(z.object({ orderId: z.string().uuid(), truckId: z.string().uuid() }))
    .min(1)
    .max(200),
});

export async function applyPlan(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<{ applied: number; failed: { orderId: string; message: string }[] }>> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = ApplyPlanSchema.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid plan payload");

  const supabase = await createSupabaseServerClient();
  let applied = 0;
  const failed: { orderId: string; message: string }[] = [];
  // Sequential on purpose: dispatch_assign_order locks order + run rows;
  // firing 200 in parallel invites deadlocks the RPC then rejects.
  for (const a of parsed.data.assignments) {
    const { error } = await supabase.rpc("dispatch_assign_order", {
      p_order: a.orderId,
      p_truck: a.truckId,
      p_source: "auto",
    });
    if (error) {
      const mapped = mapRpcError(error.message) as { ok: false; message: string };
      failed.push({ orderId: a.orderId, message: mapped.message });
    } else {
      applied += 1;
    }
  }

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok({ applied, failed });
}

const SetLoadedSchema = z.object({
  orderId: z.string().uuid(),
  loaded: z.boolean(),
});

export async function setOrderLoaded(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<void>> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = SetLoadedSchema.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid input");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_set_loaded", {
    p_order: parsed.data.orderId,
    p_loaded: parsed.data.loaded,
  });
  if (error) return mapRpcError(error.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  revalidatePath(`/${organizationSlug}/loading`);
  return ok(undefined);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/logistics/server/dispatch-actions.ts src/features/logistics/tests/unit/dispatch-actions.test.ts
git commit -m "feat(dispatch): applyPlan and setOrderLoaded server actions"
```

---

### Task 6: PlanDeck component

**Files:**
- Create: `src/features/logistics/components/plan-deck.tsx`

**Interfaces:**
- Consumes: `draftPlan`, `orderWeightKg`, `totalWeightKg` (Task 2); `buildBoardView` (existing); `applyPlan` (Task 5); `assignOrder`, `departTruck` (existing actions); `useToast` from `@/hooks/use-toast`.
- Produces: `PlanDeck({ organizationSlug, date, data, refetch }: { organizationSlug: string; date: string; data: DispatchBoardData; refetch: () => void })` — named export, client component. Wired into the page in Task 8; until then it only has to typecheck.

- [ ] **Step 1: Implement the component**

Create `src/features/logistics/components/plan-deck.tsx`:

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import type { DispatchBoardData } from "../types";
import { buildBoardView, type BoardTruck } from "../lib/dispatch-board-model";
import { draftPlan, orderWeightKg, totalWeightKg, type PlanDraft } from "../lib/plan-model";
import { applyPlan, assignOrder, departTruck } from "../server/dispatch-actions";
import { useToast } from "@/hooks/use-toast";

function Dial({ pct, label }: { pct: number; label: string }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const tone = clamped >= 95 ? "var(--destructive)" : "var(--primary)";
  return (
    <div
      className="grid size-12 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums"
      style={{ background: `conic-gradient(${tone} ${clamped}%, var(--muted) ${clamped}% 100%)` }}
      role="img"
      aria-label={label}
    >
      <span className="grid size-9 place-items-center rounded-full bg-card">{Math.round(clamped)}%</span>
    </div>
  );
}

function TruckPlanCard({
  bt,
  incoming,
  onDepart,
  departPending,
}: {
  bt: BoardTruck;
  incoming: number;
  onDepart: () => void;
  departPending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const kg = totalWeightKg(bt.tickets);
  const notReady = bt.tickets.filter((t) => t.status !== "ready").length;
  const pct =
    bt.truck.capacity_kg !== null && bt.truck.capacity_kg > 0
      ? (kg / bt.truck.capacity_kg) * 100
      : bt.cap !== null && bt.cap > 0
        ? (bt.load / bt.cap) * 100
        : 0;

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-3">
        <Dial pct={pct} label={`${bt.truck.name} load`} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{bt.truck.name}</p>
          <p className="text-xs text-muted-foreground">
            {bt.truck.code}
            {bt.truck.capacity_kg !== null ? ` · ${kg.toFixed(1)} / ${bt.truck.capacity_kg} kg` : kg > 0 ? ` · ${kg.toFixed(1)} kg` : ""}
            {" · "}
            {bt.load}
            {bt.cap !== null ? `/${bt.cap}` : ""} orders
            {incoming > 0 ? ` · +${incoming} proposed` : ""}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {bt.tickets.slice(0, 5).map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
            <span className="truncate">{t.customer?.name ?? "Customer"}</span>
            {t.loaded_at ? <span className="text-green-700 dark:text-green-400">loaded</span> : null}
            <span className="ml-auto tabular-nums text-muted-foreground">
              {orderWeightKg(t) !== null ? `${orderWeightKg(t)!.toFixed(1)} kg` : "—"}
            </span>
          </li>
        ))}
        {bt.tickets.length > 5 ? (
          <li className="px-2 text-xs text-muted-foreground">+{bt.tickets.length - 5} more</li>
        ) : null}
        {bt.tickets.length === 0 ? <li className="px-2 text-xs text-muted-foreground">No orders yet.</li> : null}
      </ul>

      {bt.departed ? (
        <p className="rounded border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
          On the road with {bt.load} order{bt.load === 1 ? "" : "s"}
        </p>
      ) : confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="min-h-9 flex-1 rounded border px-2 text-xs"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="min-h-9 flex-1 rounded bg-primary px-2 text-xs text-primary-foreground"
            onClick={() => {
              setConfirming(false);
              onDepart();
            }}
          >
            Depart, leave {notReady} behind
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={departPending || !bt.tickets.some((t) => t.status === "ready")}
          className="min-h-9 rounded bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          onClick={() => (notReady > 0 ? setConfirming(true) : onDepart())}
        >
          Depart · {bt.tickets.filter((t) => t.status === "ready").length} of {bt.load} ready
        </button>
      )}
    </article>
  );
}

export function PlanDeck({
  organizationSlug,
  date,
  data,
  refetch,
}: {
  organizationSlug: string;
  date: string;
  data: DispatchBoardData;
  refetch: () => void;
}) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  const view = useMemo(() => buildBoardView(data, date), [data, date]);
  const draft: PlanDraft = useMemo(() => draftPlan(data, date), [data, date]);
  const orderById = useMemo(() => new Map(data.orders.map((o) => [o.id, o])), [data.orders]);
  const truckById = useMemo(() => new Map(data.trucks.map((t) => [t.id, t])), [data.trucks]);
  const incomingByTruck = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of draft.proposals) m.set(p.truckId, (m.get(p.truckId) ?? 0) + 1);
    return m;
  }, [draft.proposals]);

  const boardTrucks = view.bays.flatMap((b) => b.trucks);

  const acceptAll = () => {
    startTransition(async () => {
      const result = await applyPlan(organizationSlug, {
        assignments: draft.proposals.map((p) => ({ orderId: p.orderId, truckId: p.truckId })),
      });
      if (!result.ok) {
        toast({ title: "Plan failed", description: result.message, variant: "destructive" });
      } else if (result.data.failed.length > 0) {
        toast({
          title: `Applied ${result.data.applied}, ${result.data.failed.length} failed`,
          description: result.data.failed[0]!.message,
          variant: "destructive",
        });
      } else {
        toast({ title: `Assigned ${result.data.applied} orders` });
      }
      refetch();
    });
  };

  const overrideAssign = (orderId: string, truckId: string) => {
    startTransition(async () => {
      const result = await assignOrder(organizationSlug, { orderId, truckId });
      if (!result.ok) toast({ title: "Assign failed", description: result.message, variant: "destructive" });
      refetch();
    });
  };

  const depart = (truckId: string) => {
    startTransition(async () => {
      const result = await departTruck(organizationSlug, { truckId, date });
      if (!result.ok) toast({ title: "Depart failed", description: result.message, variant: "destructive" });
      refetch();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {draft.proposals.length > 0 && !dismissed ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-accent/60 p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Draft plan ready — {draft.proposals.length} of {draft.poolCount} orders placed
            </p>
            <p className="text-xs text-muted-foreground">
              {draft.exceptions.length > 0
                ? `${draft.exceptions.length} need a decision below.`
                : "Everything in the pool has a truck."}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" className="min-h-9 rounded border px-3 text-sm" onClick={() => setDismissed(true)}>
              Dismiss
            </button>
            <button
              type="button"
              disabled={isPending}
              className="min-h-9 rounded bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              onClick={acceptAll}
            >
              Accept {draft.proposals.length}
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-2">
          {draft.exceptions.length > 0 ? (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Needs a decision · {draft.exceptions.length}
              </h2>
              {draft.exceptions.map((ex) => {
                const o = orderById.get(ex.orderId);
                return (
                  <div key={ex.orderId} className="flex flex-col gap-2 rounded-lg border border-l-4 border-l-amber-500 bg-card p-3">
                    <p className="text-sm font-medium">{o?.customer?.name ?? "Order"}</p>
                    <p className="text-xs text-muted-foreground">{ex.detail}</p>
                    {(ex.kind === "no_covering_truck" || ex.kind === "all_trucks_full") && (
                      <select
                        className="min-h-9 rounded border bg-background px-2 text-xs"
                        defaultValue=""
                        disabled={isPending}
                        onChange={(e) => {
                          if (e.target.value) overrideAssign(ex.orderId, e.target.value);
                        }}
                      >
                        <option value="" disabled>
                          Override onto…
                        </option>
                        {boardTrucks
                          .filter((bt) => !bt.departed)
                          .map((bt) => (
                            <option key={bt.truck.id} value={bt.truck.id}>
                              {bt.truck.name} ({bt.truck.code})
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </>
          ) : null}

          <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Proposed · {draft.proposals.length}
          </h2>
          {draft.proposals.map((p) => {
            const o = orderById.get(p.orderId);
            return (
              <div key={p.orderId} className="rounded-lg border border-l-4 border-l-primary bg-card p-3">
                <p className="text-sm font-medium">
                  {o?.customer?.name ?? "Order"} → {truckById.get(p.truckId)?.name ?? "truck"}
                </p>
                <p className="text-xs text-muted-foreground">{p.reason}</p>
              </div>
            );
          })}
          {draft.poolCount === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Pool is empty — every order for this date has a truck.
            </p>
          ) : null}
        </aside>

        <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {boardTrucks.map((bt) => (
            <TruckPlanCard
              key={bt.truck.id}
              bt={bt}
              incoming={incomingByTruck.get(bt.truck.id) ?? 0}
              onDepart={() => depart(bt.truck.id)}
              departPending={isPending}
            />
          ))}
          {boardTrucks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active trucks in any bay.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (component is not yet routed anywhere; unused-export is fine).

- [ ] **Step 3: Commit**

```bash
git add src/features/logistics/components/plan-deck.tsx
git commit -m "feat(dispatch): auto-plan deck component"
```

---

### Task 7: TimelineView component

**Files:**
- Create: `src/features/logistics/components/timeline-view.tsx`

**Interfaces:**
- Consumes: `buildTimeline`, `TimelineView as TimelineViewModel`, `BlockState` (Task 3).
- Produces: `DayTimeline({ date, data }: { date: string; data: DispatchBoardData })` — named export, client component, read-only (no mutations; edits happen on Plan/Board tabs).

- [ ] **Step 1: Implement the component**

Create `src/features/logistics/components/timeline-view.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { DispatchBoardData } from "../types";
import { buildTimeline, type BlockState } from "../lib/timeline-model";

const BLOCK_CLASS: Record<BlockState, string> = {
  ready: "border-green-600/40 bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  pending: "border-border bg-muted text-foreground",
  atRisk: "border-amber-600/40 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  late: "border-red-600/40 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  departed: "border-dashed border-border bg-muted/50 text-muted-foreground",
};

const STATE_LABEL: Record<BlockState, string> = {
  ready: "Ready",
  pending: "Not ready",
  atRisk: "At risk",
  late: "Late",
  departed: "On the road",
};

function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function useNowMinutes(date: string): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const compute = () =>
      setNow(date === localTodayIso() ? new Date().getHours() * 60 + new Date().getMinutes() : null);
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [date]);
  return now;
}

export function DayTimeline({ date, data }: { date: string; data: DispatchBoardData }) {
  const nowMinutes = useNowMinutes(date);
  const view = useMemo(() => buildTimeline(data, date, nowMinutes), [data, date, nowMinutes]);

  const atRiskCount = view.rows.flatMap((r) => r.blocks).filter((b) => b.state === "late" || b.state === "atRisk").length;

  // Phone agenda: all blocks across trucks, by time.
  const agenda = useMemo(
    () =>
      view.rows
        .flatMap((r) => r.blocks.map((b) => ({ ...b, truckName: r.truck.name })))
        .sort((a, b) => a.startMin - b.startMin),
    [view.rows],
  );

  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {fmt(view.windowStart)} — {fmt(view.windowEnd)}
        </span>
        {atRiskCount > 0 ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200">
            {atRiskCount} at risk
          </span>
        ) : null}
        {view.poolCount > 0 ? <span>{view.poolCount} unassigned (not shown — see Plan)</span> : null}
      </div>

      {/* Desktop / tablet: trucks × hours grid */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <div className="min-w-[720px]">
          <div className="grid border-b bg-muted/50" style={{ gridTemplateColumns: `140px repeat(${view.hours.length - 1}, 1fr)` }}>
            <span className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Truck</span>
            {view.hours.slice(0, -1).map((h) => (
              <span key={h} className="border-l px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {view.rows.map((row) => (
            <div key={row.truck.id} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: "140px 1fr" }}>
              <div className="border-r bg-muted/30 px-3 py-2">
                <p className="text-sm font-semibold">{row.truck.name}</p>
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {row.truck.code}
                  {row.loadKg > 0 ? ` · ${row.loadKg.toFixed(1)} kg` : ""}
                  {row.departed ? " · on the road" : ""}
                </p>
              </div>
              <div className="relative h-16">
                {view.hours.slice(1, -1).map((h, i) => (
                  <span
                    key={h}
                    className="absolute inset-y-0 border-l"
                    style={{ left: `${(((h * 60 - view.windowStart) / (view.windowEnd - view.windowStart)) * 100).toFixed(3)}%` }}
                    aria-hidden
                  />
                ))}
                {row.blocks.map((b) => (
                  <div
                    key={b.ticket.id}
                    className={`absolute top-2 flex h-12 min-w-16 flex-col overflow-hidden rounded-md border px-2 py-1 ${BLOCK_CLASS[b.state]}`}
                    style={{ left: `${b.startPct}%`, width: `${Math.max(b.widthPct, 6)}%` }}
                    title={`${b.ticket.customer?.name ?? "Order"} · ${fmt(b.startMin)} · ${STATE_LABEL[b.state]}`}
                  >
                    <span className="truncate text-[11px] font-semibold">{b.ticket.customer?.name ?? "Order"}</span>
                    <span className="truncate text-[10px] tabular-nums opacity-80">
                      {fmt(b.startMin)} · {STATE_LABEL[b.state]}
                    </span>
                  </div>
                ))}
                {view.nowPct !== null ? (
                  <span
                    className="absolute inset-y-0 w-0.5 bg-primary"
                    style={{ left: `${view.nowPct}%` }}
                    aria-label="Now"
                  />
                ) : null}
              </div>
            </div>
          ))}
          {view.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No trucks on the board for this date.</p>
          ) : null}
        </div>
      </div>

      {/* Phone: agenda grouped by start time */}
      <div className="flex flex-col gap-2 md:hidden">
        {agenda.map((b) => (
          <div key={b.ticket.id} className={`flex items-center gap-3 rounded-lg border p-3 ${BLOCK_CLASS[b.state]}`}>
            <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{fmt(b.startMin)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{b.ticket.customer?.name ?? "Order"}</p>
              <p className="truncate text-xs opacity-80">
                {b.truckName} · {STATE_LABEL[b.state]}
              </p>
            </div>
          </div>
        ))}
        {agenda.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nothing scheduled for this date.</p>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/logistics/components/timeline-view.tsx
git commit -m "feat(dispatch): day timeline component (grid + phone agenda)"
```

---

### Task 8: DispatchClient shell + controlled DispatchBoard + page wiring

**Files:**
- Create: `src/features/logistics/components/dispatch-client.tsx`
- Modify: `src/features/logistics/components/dispatch-board.tsx`
- Modify: `src/app/(seller)/[organizationSlug]/dispatch/page.tsx`

**Interfaces:**
- Consumes: `PlanDeck` (Task 6), `DayTimeline` (Task 7), `getDispatchBoard` (existing).
- Produces:
  - `DispatchClient({ organizationSlug, initialDate, initialData })` — owns `date`, `data`, `refetch`, `view` state; renders header + tab switcher.
  - `DispatchBoard` signature CHANGES to `{ organizationSlug: string; date: string; data: DispatchBoardData; refetch: () => void }` (controlled; internal date/data/refetch state and the header row are removed).

- [ ] **Step 1: Make DispatchBoard controlled**

In `src/features/logistics/components/dispatch-board.tsx`:

1. Change the props to `{ organizationSlug, date, data, refetch }: { organizationSlug: string; date: string; data: DispatchBoardData; refetch: () => void }`.
2. Delete the `useState` for `date`/`data`, the `dateRef` + its `useEffect`, the internal `refetch` callback, and the `getDispatchBoard` import.
3. Delete the header block (the `<div className="flex items-center gap-3">` containing the `<h1>Dispatch</h1>`, the date `<input>`, and the facility span) — the shell renders it now.
4. Everything else (drag handlers, override/depart dialogs, `runAction`, `doDepart`) keeps working: `runAction` and `doDepart` call the `refetch` prop instead of the removed internal one; `doDepart` uses the `date` prop.

The resulting component body starts at the `DndContext` wrapper inside a fragment (keep the two dialogs as siblings).

- [ ] **Step 2: Create the DispatchClient shell**

Create `src/features/logistics/components/dispatch-client.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import type { DispatchBoardData } from "../types";
import { getDispatchBoard } from "../server/dispatch-actions";
import { DispatchBoard } from "./dispatch-board";
import { PlanDeck } from "./plan-deck";
import { DayTimeline } from "./timeline-view";
import { useToast } from "@/hooks/use-toast";

type DispatchView = "plan" | "timeline" | "board";

const VIEWS: { id: DispatchView; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "timeline", label: "Timeline" },
  { id: "board", label: "Board" },
];

export function DispatchClient({
  organizationSlug,
  initialDate,
  initialData,
}: {
  organizationSlug: string;
  initialDate: string;
  initialData: DispatchBoardData;
}) {
  const [date, setDate] = useState(initialDate);
  const dateRef = useRef(date);
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<DispatchView>("plan");
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  const refetch = useCallback(() => {
    const forDate = dateRef.current;
    startTransition(async () => {
      const result = await getDispatchBoard(organizationSlug, forDate);
      // The user may have switched dates while this request was in flight.
      if (forDate !== dateRef.current) return;
      if (result.ok) setData(result.data);
      else toast({ title: "Error", description: result.message, variant: "destructive" });
    });
  }, [organizationSlug, toast]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Dispatch</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            dateRef.current = e.target.value;
            refetch();
          }}
          className="rounded border px-2 py-1 text-sm"
        />
        {data.facility ? (
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {data.facility.name} — {data.facility.address_line}, {data.facility.postcode}
          </span>
        ) : null}
        <div className="ml-auto flex rounded-lg border bg-muted p-0.5" role="tablist" aria-label="Dispatch view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={`min-h-9 rounded-md px-3 text-sm transition-colors motion-reduce:transition-none ${
                view === v.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
              }`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "plan" ? (
        <PlanDeck organizationSlug={organizationSlug} date={date} data={data} refetch={refetch} />
      ) : view === "timeline" ? (
        <DayTimeline date={date} data={data} />
      ) : (
        <DispatchBoard organizationSlug={organizationSlug} date={date} data={data} refetch={refetch} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the page**

In `src/app/(seller)/[organizationSlug]/dispatch/page.tsx`, replace the `DispatchBoard` import + render with:

```tsx
import { DispatchClient } from "@/features/logistics/components/dispatch-client";
// ...
return (
  <DispatchClient organizationSlug={organizationSlug} initialDate={date} initialData={result.data} />
);
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/components/dispatch-client.tsx src/features/logistics/components/dispatch-board.tsx "src/app/(seller)/[organizationSlug]/dispatch/page.tsx"
git commit -m "feat(dispatch): view switcher shell — plan deck, timeline, board"
```

---

### Task 9: Loading route + LoadingClient + sidebar link

**Files:**
- Create: `src/app/(seller)/[organizationSlug]/loading/page.tsx`
- Create: `src/features/logistics/components/loading-client.tsx`
- Modify: `src/features/dashboard/components/app-sidebar.tsx` (and/or the nav model it reads — grep first)

**Interfaces:**
- Consumes: `buildLoadQueue`, `truckSummaries` (Task 4); `setOrderLoaded`, `getDispatchBoard` (Task 5 / existing).
- Produces: route `/{organizationSlug}/loading`; `LoadingClient({ organizationSlug, initialDate, initialData })`.

- [ ] **Step 1: Create the page**

Create `src/app/(seller)/[organizationSlug]/loading/page.tsx` (mirror `dispatch/page.tsx` exactly, including `todayIsoDate` — copy the function):

```tsx
import { redirect } from "next/navigation";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { DISPATCH_ROLES } from "@/features/logistics/lib/roles";
import { getDispatchBoard } from "@/features/logistics/server/dispatch-actions";
import { LoadingClient } from "@/features/logistics/components/loading-client";

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function LoadingPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  try {
    await requireOrgRole(organizationSlug, DISPATCH_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}/tasks`);
    }
    throw error;
  }

  const date = todayIsoDate();
  const result = await getDispatchBoard(organizationSlug, date);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return (
    <LoadingClient organizationSlug={organizationSlug} initialDate={date} initialData={result.data} />
  );
}
```

- [ ] **Step 2: Create LoadingClient**

Create `src/features/logistics/components/loading-client.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { DispatchBoardData } from "../types";
import { buildLoadQueue, truckSummaries, type LoadJob } from "../lib/loading-model";
import { getDispatchBoard, setOrderLoaded } from "../server/dispatch-actions";
import { useToast } from "@/hooks/use-toast";

function JobCard({
  job,
  pending,
  onToggle,
}: {
  job: LoadJob;
  pending: boolean;
  onToggle: (loaded: boolean) => void;
}) {
  if (job.loaded) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed bg-muted/40 p-3">
        <span className="text-sm text-muted-foreground line-through">{job.ticket.customer?.name ?? "Order"}</span>
        <span className="text-xs text-green-700 dark:text-green-400">loaded</span>
        <button
          type="button"
          disabled={pending}
          className="ml-auto min-h-11 rounded-lg border px-3 text-sm"
          onClick={() => onToggle(false)}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div>
        <h3 className="text-xl font-semibold leading-tight">{job.ticket.customer?.name ?? "Order"}</h3>
        <p className="text-xs text-muted-foreground">
          {job.ticket.zone?.name ? `${job.ticket.zone.name} · ` : ""}
          {job.ticket.postcode ?? "no postcode"}
          {job.slotStart ? ` · slot ${job.slotStart}` : ""}
        </p>
      </div>

      <div className="flex items-baseline gap-2 rounded-xl border bg-muted/50 px-4 py-3">
        <span className="text-4xl font-bold tabular-nums leading-none">
          {job.weightKg !== null ? job.weightKg.toFixed(1) : "—"}
        </span>
        <span className="text-sm text-muted-foreground">kg</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {job.ticket.status === "ready" ? "weighed & ready" : "not weighed yet"}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {job.lines.map((line, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="truncate">{line.name}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {line.pieces !== null ? `${line.pieces} pcs` : `×${line.quantity}`}
              {line.weightKg !== null ? ` · ${line.weightKg.toFixed(1)} kg` : ""}
            </span>
          </li>
        ))}
        {job.lines.length === 0 ? <li className="px-3 text-sm text-muted-foreground">No items.</li> : null}
      </ul>

      <button
        type="button"
        disabled={pending}
        className="min-h-14 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
        onClick={() => onToggle(true)}
      >
        Loaded ✓
      </button>
    </article>
  );
}

export function LoadingClient({
  organizationSlug,
  initialDate,
  initialData,
}: {
  organizationSlug: string;
  initialDate: string;
  initialData: DispatchBoardData;
}) {
  const date = initialDate; // loading is always today
  const [data, setData] = useState(initialData);
  const [truckId, setTruckId] = useState<string | null>(null);
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const refetch = useCallback(() => {
    startTransition(async () => {
      const result = await getDispatchBoard(organizationSlug, date);
      if (result.ok) setData(result.data);
      else toast({ title: "Error", description: result.message, variant: "destructive" });
    });
  }, [organizationSlug, date, toast]);

  const summaries = useMemo(() => truckSummaries(data, date), [data, date]);
  const queue = useMemo(
    () => (truckId ? buildLoadQueue(data, date, truckId) : null),
    [data, date, truckId],
  );

  const toggle = (orderId: string, loaded: boolean) => {
    startTransition(async () => {
      const result = await setOrderLoaded(organizationSlug, { orderId, loaded });
      if (!result.ok) toast({ title: "Could not update", description: result.message, variant: "destructive" });
      refetch();
    });
  };

  if (!queue) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        <h1 className="text-lg font-semibold">Loading</h1>
        <p className="text-sm text-muted-foreground">Pick your truck to start loading.</p>
        {summaries.map((s) => (
          <button
            key={s.truck.id}
            type="button"
            disabled={s.departed}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm disabled:opacity-50"
            onClick={() => setTruckId(s.truck.id)}
          >
            <div className="min-w-0">
              <p className="truncate font-semibold">{s.truck.name}</p>
              <p className="text-xs text-muted-foreground">
                {s.truck.code} · {s.bayName}
                {s.departed ? " · on the road" : ""}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm font-semibold tabular-nums">
                {s.doneCount}/{s.totalCount}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {s.totalKg > 0 ? `${s.totalKg.toFixed(1)} kg` : "—"}
              </p>
            </div>
          </button>
        ))}
        {summaries.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No trucks on the board today.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-2xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg border px-3 text-sm"
          onClick={() => setTruckId(null)}
        >
          ← Trucks
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground">
              {queue.truck.name} · {queue.truck.code}
            </span>
            <span className="tabular-nums">
              {queue.doneCount} of {queue.totalCount} loaded
              {queue.totalKg > 0 ? ` · ${queue.loadedKg.toFixed(1)}/${queue.totalKg.toFixed(1)} kg` : ""}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
              style={{ width: `${queue.totalCount > 0 ? (queue.doneCount / queue.totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {queue.departed ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          This truck has departed — loading is closed.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {queue.jobs.map((job) => (
            <JobCard
              key={job.ticket.id}
              job={job}
              pending={isPending}
              onToggle={(loaded) => toggle(job.ticket.id, loaded)}
            />
          ))}
          {queue.jobs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nothing assigned to this truck yet.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the sidebar link**

Grep for how "Dispatch" is declared: `grep -rn "Dispatch" src/features/dashboard/components/app-sidebar.tsx src/features/dashboard/components/dashboard-shell-model.ts`. Add a "Loading" entry directly after the Dispatch entry, same shape, href `/${organizationSlug}/loading` (or the model's route token pattern), same role gating as Dispatch. If `dashboard-shell-model.ts` drives nav and has tests (`dashboard-shell-model.test.ts`), update the test's expected nav list too.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/loading" src/features/logistics/components/loading-client.tsx
git add -p src/features/dashboard/components/app-sidebar.tsx src/features/dashboard/components/dashboard-shell-model.ts src/features/dashboard/tests/unit/dashboard-shell-model.test.ts
git commit -m "feat(dispatch): loader screen at /loading with per-truck queue"
```

(`git add -p` on the sidebar files because they carry unrelated uncommitted hunks — stage ONLY the Loading-entry hunks.)

---

### Task 10: Verification pass

**Files:** none (verification only; fix-forward anything found and amend the relevant task's commit style).

- [ ] **Step 1: Full test suite + typecheck + lint**

Run: `npx tsc --noEmit && npm test && npx next lint --dir src/features/logistics --dir "src/app/(seller)/[organizationSlug]" 2>/dev/null || true`
Expected: tsc clean, all vitest suites pass. (Lint step is best-effort; if the repo has no lint script config for `next lint`, skip.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles; `/[organizationSlug]/dispatch` and `/[organizationSlug]/loading` both listed in the route output.

- [ ] **Step 3: Browser verification (MAIN SESSION, not a subagent)**

Start the dev server via the Browser pane (launch.json config if present) and verify against the pilot org:
1. `/dispatch` — Plan tab default: draft banner with counts, exceptions with override select, truck cards with dial, Accept applies and board refetches.
2. Timeline tab — blocks positioned by slot, now-line on today, states colored; resize to phone width: agenda list replaces grid.
3. Board tab — existing drag-and-drop still assigns/unassigns; depart flow intact.
4. `/loading` — truck picker; queue; Loaded moves job to receipt state; Undo restores; progress bar updates; check at 390px width, dark mode, and `prefers-reduced-motion`.
5. Screenshot each surface as proof.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add <only-files-you-fixed>
git commit -m "fix(dispatch): verification fixes"
```
