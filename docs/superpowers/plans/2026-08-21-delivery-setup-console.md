# Delivery Setup Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven-tab table-and-modal Delivery Setup page with a master–detail console that has no modals, a global search across every setup entity, and a readiness panel that surfaces misconfiguration before it breaks dispatch.

**Architecture:** All readiness checks and search are pure functions over the data the page already loads — no new queries, no migration. They live in a new `setup-model.ts` in the logistics feature (which already imports orders types) and are unit tested with vitest. The UI becomes a three-pane console: an entity rail with live counts, a searchable list, and an always-open detail pane with a sticky save bar. The three existing panels (`FacilityPanel`, `BaysPanel`, `PostcodeRangesPanel`) are reused verbatim as detail-pane content rather than rewritten. Archive replaces delete as the primary destructive action, implemented by flipping `is_active` through the existing update actions — no new server actions needed for it.

**Tech Stack:** Next.js App Router (client component), React 19 `useState`, Tailwind + shadcn/ui primitives already in the repo, vitest for unit tests, existing Supabase server actions in `src/features/orders/server/schedule-actions.ts`.

## Global Constraints

- Data model is unchanged. No SQL migration in this plan.
- Every readiness check is derived from `DeliverySetup` + `LogisticsSetup` already passed into the page. No new fetches.
- Pure logic goes in `src/features/logistics/lib/setup-model.ts`; components never re-derive it inline.
- Unit tests live at `src/features/logistics/tests/unit/setup-model.test.ts` and run under `npx vitest run` (config: `vitest.config.ts`, include glob `src/features/**/tests/unit/**/*.test.ts`, `environment: "node"`).
- Row types are snake_case (mirror the DB); action inputs are camelCase (mirror the Zod schemas). Do not mix.
- Time values from the DB arrive as `HH:MM:SS`; the UI renders `slice(0, 5)`. Comparisons must normalise first.
- Touch targets in the console are minimum 44px at viewport < 1280px.
- Archive is the primary retire action for zones, trucks and slots. Hard delete stays available only in an overflow menu, keeps its existing `confirm()`. Blocked dates keep plain removal — nothing references them.
- Commit messages follow the repo convention: `feat(seller): …`, `fix(seller): …`, `test(logistics): …`, and end with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/features/logistics/lib/setup-model.ts` (create) | Pure readiness checks + search over the combined setup. No React. |
| `src/features/logistics/tests/unit/setup-model.test.ts` (create) | Unit tests for the above. |
| `src/features/orders/types.ts` (modify) | `TruckInputSchema` gains `capacityKg` and `bayId`. |
| `src/features/orders/server/schedule-actions.ts` (modify) | `createTruck` / `updateTruck` persist the two new fields. |
| `src/features/logistics/components/setup/readiness-panel.tsx` (create) | Renders `SetupIssue[]`, each with a Fix button that selects the target record. |
| `src/features/logistics/components/setup/entity-rail.tsx` (create) | Seven entities with live counts + issue badges; the console's left pane. |
| `src/features/logistics/components/setup/record-list.tsx` (create) | Middle pane: filtered, searchable list of the selected entity. |
| `src/features/logistics/components/setup/detail-forms.tsx` (create) | Right pane form bodies for zone / truck / slot / block. |
| `src/features/logistics/components/setup/setup-console.tsx` (create) | The shell: pane layout, responsive drill-down, sticky save bar, archive + undo. |
| `src/app/(seller)/[organizationSlug]/delivery/delivery-client.tsx` (modify) | Owns state and server-action calls; renders `SetupConsole` instead of `Tabs`. |

---

### Task 1: Readiness model — relationship checks

**Files:**
- Create: `src/features/logistics/lib/setup-model.ts`
- Test: `src/features/logistics/tests/unit/setup-model.test.ts`

**Interfaces:**
- Consumes: `DeliverySetup`, `DeliveryZone`, `Truck`, `TruckZone`, `DeliverySlot`, `ScheduleBlock` from `@/features/orders/types`; `Facility`, `Bay`, `ZonePostcodeRange` from `../types`.
- Produces:
  ```ts
  export type SetupEntity =
    | "zones" | "trucks" | "slots" | "blocks" | "factory" | "bays" | "postcodes";

  export type IssueSeverity = "blocker" | "warning" | "info";

  export type SetupIssue = {
    /** Stable key, unique per issue instance. Used as the React key. */
    id: string;
    severity: IssueSeverity;
    /** One line, sentence case, names the record. */
    title: string;
    /** One line, explains the consequence in business terms. */
    detail: string;
    /** Where the Fix button navigates. recordId is null when the fix is "add one". */
    target: { entity: SetupEntity; recordId: string | null };
  };

  export type SetupSnapshot = {
    zones: DeliveryZone[];
    trucks: Truck[];
    truckZones: TruckZone[];
    slots: DeliverySlot[];
    blocks: ScheduleBlock[];
    facility: Facility | null;
    bays: Bay[];
    ranges: ZonePostcodeRange[];
  };

  export function findIssues(snapshot: SetupSnapshot): SetupIssue[];
  ```

- [ ] **Step 1: Write the failing test**

Create `src/features/logistics/tests/unit/setup-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SetupSnapshot } from "../../lib/setup-model";
import { findIssues } from "../../lib/setup-model";

let n = 0;
const uid = (p: string) => `${p}-${++n}`.padEnd(36, "0");

function zone(over: Partial<SetupSnapshot["zones"][number]> = {}) {
  return {
    id: uid("zone"), organization_id: "org", name: "Zone 1", display_order: 0,
    is_active: true, created_by: null, created_at: "", updated_at: "", version: 1, ...over,
  };
}

function truck(over: Partial<SetupSnapshot["trucks"][number]> = {}) {
  return {
    id: uid("truck"), organization_id: "org", name: "Canter 01", code: "T1",
    is_active: true, bay_id: "bay-1", capacity_kg: 1200,
    created_by: null, created_at: "", updated_at: "", version: 1, ...over,
  };
}

function slot(over: Partial<SetupSnapshot["slots"][number]> = {}) {
  return {
    id: uid("slot"), organization_id: "org", truck_id: "truck-x", weekday: 1,
    start_time: "08:00:00", end_time: "12:00:00", max_orders: 12, is_active: true,
    created_by: null, created_at: "", updated_at: "", version: 1, ...over,
  };
}

function facility() {
  return {
    id: uid("fac"), organization_id: "org", name: "Kilang", address_line: "1 Jalan",
    postcode: "47000", state: "Selangor", is_active: true,
    created_by: null, created_at: "", updated_at: "", version: 1,
  };
}

/** A snapshot with zero issues: one factory, one zone with a range, one truck
 *  covering it with an active slot. Every test starts here and breaks one thing. */
function healthy(): SetupSnapshot {
  const z = zone({ id: "zone-1".padEnd(36, "0") });
  const t = truck({ id: "truck-1".padEnd(36, "0") });
  return {
    zones: [z],
    trucks: [t],
    truckZones: [{ truck_id: t.id, zone_id: z.id, organization_id: "org" }],
    slots: [slot({ truck_id: t.id })],
    blocks: [],
    facility: facility(),
    bays: [],
    ranges: [{
      id: uid("range"), organization_id: "org", zone_id: z.id,
      postcode_start: "47000", postcode_end: "47810", created_by: null, created_at: "",
    }],
  };
}

const ids = (issues: ReturnType<typeof findIssues>) => issues.map((i) => i.id);

describe("findIssues — relationships", () => {
  it("reports nothing for a fully configured setup", () => {
    expect(findIssues(healthy())).toEqual([]);
  });

  it("flags an active truck with no zone", () => {
    const s = healthy();
    s.truckZones = [];
    const issues = findIssues(s);
    expect(ids(issues)).toContain(`truck-no-zone:${s.trucks[0].id}`);
    expect(issues.find((i) => i.id.startsWith("truck-no-zone"))?.severity).toBe("warning");
  });

  it("flags an active truck with no active slots", () => {
    const s = healthy();
    s.slots = [slot({ truck_id: s.trucks[0].id, is_active: false })];
    expect(ids(findIssues(s))).toContain(`truck-no-slots:${s.trucks[0].id}`);
  });

  it("flags an active zone no active truck covers", () => {
    const s = healthy();
    s.trucks = [truck({ id: s.trucks[0].id, is_active: false })];
    expect(ids(findIssues(s))).toContain(`zone-no-truck:${s.zones[0].id}`);
  });

  it("flags an active zone with no postcode ranges as a blocker", () => {
    const s = healthy();
    s.ranges = [];
    const issue = findIssues(s).find((i) => i.id === `zone-no-postcodes:${s.zones[0].id}`);
    expect(issue?.severity).toBe("blocker");
    expect(issue?.target).toEqual({ entity: "postcodes", recordId: s.zones[0].id });
  });

  it("flags a missing factory as a blocker", () => {
    const s = healthy();
    s.facility = null;
    const issue = findIssues(s).find((i) => i.id === "no-facility");
    expect(issue?.severity).toBe("blocker");
    expect(issue?.target).toEqual({ entity: "factory", recordId: null });
  });

  it("ignores archived zones and trucks entirely", () => {
    const s = healthy();
    s.zones = [...s.zones, zone({ id: "zone-old".padEnd(36, "0"), is_active: false })];
    s.trucks = [...s.trucks, truck({ id: "truck-old".padEnd(36, "0"), is_active: false })];
    expect(findIssues(s)).toEqual([]);
  });

  it("sorts blockers before warnings before info", () => {
    const s = healthy();
    s.facility = null;      // blocker
    s.truckZones = [];      // warning
    const severities = findIssues(s).map((i) => i.severity);
    expect(severities.indexOf("blocker")).toBeLessThan(severities.indexOf("warning"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/setup-model.test.ts`
Expected: FAIL — `Failed to resolve import "../../lib/setup-model"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/logistics/lib/setup-model.ts`:

```ts
/**
 * Pure derivation over the whole delivery setup: what is misconfigured, and
 * what does a given search string match. Nothing here touches the network —
 * the page already loads every row it needs, so readiness is a fold over
 * state, not a query. Archived records (is_active = false) are invisible to
 * every check: retiring a truck must not raise an issue about it.
 */

import type {
  DeliverySlot,
  DeliveryZone,
  ScheduleBlock,
  Truck,
  TruckZone,
} from "@/features/orders/types";
import type { Bay, Facility, ZonePostcodeRange } from "../types";

export type SetupEntity =
  | "zones" | "trucks" | "slots" | "blocks" | "factory" | "bays" | "postcodes";

export type IssueSeverity = "blocker" | "warning" | "info";

export type SetupIssue = {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  target: { entity: SetupEntity; recordId: string | null };
};

export type SetupSnapshot = {
  zones: DeliveryZone[];
  trucks: Truck[];
  truckZones: TruckZone[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
  facility: Facility | null;
  bays: Bay[];
  ranges: ZonePostcodeRange[];
};

const SEVERITY_ORDER: Record<IssueSeverity, number> = { blocker: 0, warning: 1, info: 2 };

export function findIssues(snapshot: SetupSnapshot): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const liveZones = snapshot.zones.filter((z) => z.is_active);
  const liveTrucks = snapshot.trucks.filter((t) => t.is_active);
  const liveTruckIds = new Set(liveTrucks.map((t) => t.id));
  const liveZoneIds = new Set(liveZones.map((z) => z.id));
  const liveLinks = snapshot.truckZones.filter(
    (tz) => liveTruckIds.has(tz.truck_id) && liveZoneIds.has(tz.zone_id),
  );
  const activeSlots = snapshot.slots.filter(
    (s) => s.is_active && liveTruckIds.has(s.truck_id),
  );

  if (snapshot.facility === null) {
    issues.push({
      id: "no-facility",
      severity: "blocker",
      title: "No factory address set",
      detail: "Dispatch cannot plan routes or print delivery orders without it.",
      target: { entity: "factory", recordId: null },
    });
  }

  for (const zone of liveZones) {
    if (!snapshot.ranges.some((r) => r.zone_id === zone.id)) {
      issues.push({
        id: `zone-no-postcodes:${zone.id}`,
        severity: "blocker",
        title: `${zone.name} has no postcodes`,
        detail: "No customer address can be matched to this zone at checkout.",
        target: { entity: "postcodes", recordId: zone.id },
      });
    }
    if (!liveLinks.some((tz) => tz.zone_id === zone.id)) {
      issues.push({
        id: `zone-no-truck:${zone.id}`,
        severity: "warning",
        title: `No truck covers ${zone.name}`,
        detail: "Orders in this zone will never be auto-assigned on the dispatch board.",
        target: { entity: "zones", recordId: zone.id },
      });
    }
  }

  for (const truck of liveTrucks) {
    if (!liveLinks.some((tz) => tz.truck_id === truck.id)) {
      issues.push({
        id: `truck-no-zone:${truck.id}`,
        severity: "warning",
        title: `${truck.name} serves no zone`,
        detail: "Auto-plan will skip this truck, so it stays idle.",
        target: { entity: "trucks", recordId: truck.id },
      });
    }
    if (!activeSlots.some((s) => s.truck_id === truck.id)) {
      issues.push({
        id: `truck-no-slots:${truck.id}`,
        severity: "warning",
        title: `${truck.name} has no delivery slots`,
        detail: "Customers cannot book a delivery date on this truck.",
        target: { entity: "slots", recordId: truck.id },
      });
    }
  }

  return issues.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/setup-model.test.ts`
Expected: PASS — 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/setup-model.ts src/features/logistics/tests/unit/setup-model.test.ts
git commit -m "$(cat <<'EOF'
feat(logistics): derive delivery setup readiness issues

Relationship checks over the setup the page already loads: missing
factory, zones with no postcodes or no truck, trucks with no zone or no
slots. Archived rows are invisible to every check so retiring a truck
does not raise an issue about it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Readiness model — overlap and completeness checks

**Files:**
- Modify: `src/features/logistics/lib/setup-model.ts`
- Test: `src/features/logistics/tests/unit/setup-model.test.ts`

**Interfaces:**
- Consumes: `findIssues`, `SetupSnapshot` from Task 1.
- Produces: no new exports. `findIssues` gains four issue kinds with these id shapes:
  `postcode-overlap:<zoneIdA>:<zoneIdB>`, `range-inverted:<rangeId>`,
  `slot-overlap:<slotIdA>:<slotIdB>`, `truck-no-capacity:<truckId>`.

- [ ] **Step 1: Write the failing test**

Append to `src/features/logistics/tests/unit/setup-model.test.ts`:

```ts
describe("findIssues — overlaps and completeness", () => {
  it("flags two zones claiming the same postcodes", () => {
    const s = healthy();
    const other = zone({ id: "zone-2".padEnd(36, "0"), name: "Zone 2" });
    s.zones = [...s.zones, other];
    s.truckZones = [...s.truckZones, {
      truck_id: s.trucks[0].id, zone_id: other.id, organization_id: "org",
    }];
    s.ranges = [...s.ranges, {
      id: uid("range"), organization_id: "org", zone_id: other.id,
      postcode_start: "47500", postcode_end: "47900", created_by: null, created_at: "",
    }];
    const issue = findIssues(s).find((i) => i.id.startsWith("postcode-overlap:"));
    expect(issue?.severity).toBe("blocker");
    expect(issue?.detail).toContain("47500");
  });

  it("does not flag two ranges of the same zone overlapping", () => {
    const s = healthy();
    s.ranges = [...s.ranges, {
      id: uid("range"), organization_id: "org", zone_id: s.zones[0].id,
      postcode_start: "47500", postcode_end: "47900", created_by: null, created_at: "",
    }];
    expect(ids(findIssues(s)).some((i) => i.startsWith("postcode-overlap:"))).toBe(false);
  });

  it("flags a range whose start is after its end", () => {
    const s = healthy();
    s.ranges = [{
      id: "range-bad".padEnd(36, "0"), organization_id: "org", zone_id: s.zones[0].id,
      postcode_start: "47800", postcode_end: "47000", created_by: null, created_at: "",
    }];
    expect(ids(findIssues(s))).toContain(`range-inverted:range-bad`.padEnd(0));
  });

  it("flags two active slots overlapping on the same truck and weekday", () => {
    const s = healthy();
    const t = s.trucks[0].id;
    s.slots = [
      slot({ id: "slot-a".padEnd(36, "0"), truck_id: t, weekday: 1, start_time: "08:00:00", end_time: "12:00:00" }),
      slot({ id: "slot-b".padEnd(36, "0"), truck_id: t, weekday: 1, start_time: "11:00:00", end_time: "14:00:00" }),
    ];
    expect(ids(findIssues(s)).some((i) => i.startsWith("slot-overlap:"))).toBe(true);
  });

  it("does not flag slots that merely touch at the boundary", () => {
    const s = healthy();
    const t = s.trucks[0].id;
    s.slots = [
      slot({ truck_id: t, weekday: 1, start_time: "08:00:00", end_time: "12:00:00" }),
      slot({ truck_id: t, weekday: 1, start_time: "12:00:00", end_time: "16:00:00" }),
    ];
    expect(ids(findIssues(s)).some((i) => i.startsWith("slot-overlap:"))).toBe(false);
  });

  it("does not flag overlapping slots on different weekdays", () => {
    const s = healthy();
    const t = s.trucks[0].id;
    s.slots = [
      slot({ truck_id: t, weekday: 1, start_time: "08:00:00", end_time: "12:00:00" }),
      slot({ truck_id: t, weekday: 2, start_time: "08:00:00", end_time: "12:00:00" }),
    ];
    expect(ids(findIssues(s)).some((i) => i.startsWith("slot-overlap:"))).toBe(false);
  });

  it("reports a truck with no capacity as info, not a warning", () => {
    const s = healthy();
    s.trucks = [truck({ id: s.trucks[0].id, capacity_kg: null })];
    const issue = findIssues(s).find((i) => i.id.startsWith("truck-no-capacity:"));
    expect(issue?.severity).toBe("info");
  });
});
```

Fix the one awkward assertion before running — replace

```ts
    expect(ids(findIssues(s))).toContain(`range-inverted:range-bad`.padEnd(0));
```

with

```ts
    expect(ids(findIssues(s))).toContain(`range-inverted:${"range-bad".padEnd(36, "0")}`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/setup-model.test.ts`
Expected: FAIL — the seven new assertions fail; the Task 1 block still passes.

- [ ] **Step 3: Write minimal implementation**

In `src/features/logistics/lib/setup-model.ts`, add above `findIssues`:

```ts
/** "08:00:00" and "08:00" both become 480. */
export function minutesOfTime(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

/** Half-open intervals: touching at a boundary is not an overlap. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
```

Then inside `findIssues`, after the truck loop and before the `return`:

```ts
  for (const truck of liveTrucks) {
    if (truck.capacity_kg === null) {
      issues.push({
        id: `truck-no-capacity:${truck.id}`,
        severity: "info",
        title: `${truck.name} has no capacity set`,
        detail: "Load planning cannot warn when this truck is overbooked.",
        target: { entity: "trucks", recordId: truck.id },
      });
    }
  }

  const liveRanges = snapshot.ranges.filter((r) => liveZoneIds.has(r.zone_id));
  for (const range of liveRanges) {
    if (range.postcode_start > range.postcode_end) {
      issues.push({
        id: `range-inverted:${range.id}`,
        severity: "warning",
        title: `Postcode range ${range.postcode_start}–${range.postcode_end} is backwards`,
        detail: "The start is higher than the end, so it matches nothing.",
        target: { entity: "postcodes", recordId: range.zone_id },
      });
    }
  }

  const zoneName = (id: string) =>
    snapshot.zones.find((z) => z.id === id)?.name ?? "Unknown zone";

  for (let i = 0; i < liveRanges.length; i += 1) {
    for (let j = i + 1; j < liveRanges.length; j += 1) {
      const a = liveRanges[i];
      const b = liveRanges[j];
      if (a.zone_id === b.zone_id) continue;
      if (a.postcode_start > b.postcode_end || b.postcode_start > a.postcode_end) continue;
      issues.push({
        id: `postcode-overlap:${a.zone_id}:${b.zone_id}`,
        severity: "blocker",
        title: `${zoneName(a.zone_id)} and ${zoneName(b.zone_id)} claim the same postcodes`,
        detail: `${a.postcode_start}–${a.postcode_end} overlaps ${b.postcode_start}–${b.postcode_end}. Whichever zone sorts first silently wins.`,
        target: { entity: "postcodes", recordId: a.zone_id },
      });
    }
  }

  for (let i = 0; i < activeSlots.length; i += 1) {
    for (let j = i + 1; j < activeSlots.length; j += 1) {
      const a = activeSlots[i];
      const b = activeSlots[j];
      if (a.truck_id !== b.truck_id || a.weekday !== b.weekday) continue;
      if (!overlaps(
        minutesOfTime(a.start_time), minutesOfTime(a.end_time),
        minutesOfTime(b.start_time), minutesOfTime(b.end_time),
      )) continue;
      const name = snapshot.trucks.find((t) => t.id === a.truck_id)?.name ?? "Truck";
      issues.push({
        id: `slot-overlap:${a.id}:${b.id}`,
        severity: "warning",
        title: `${name} has two slots at the same time`,
        detail: `${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)} overlaps ${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}. Capacity is counted twice.`,
        target: { entity: "slots", recordId: a.truck_id },
      });
    }
  }
```

Note the existing healthy-setup test asserts `findIssues(healthy())` is empty — `healthy()` sets `capacity_kg: 1200`, so the info check does not fire there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/setup-model.test.ts`
Expected: PASS — 15 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/setup-model.ts src/features/logistics/tests/unit/setup-model.test.ts
git commit -m "$(cat <<'EOF'
feat(logistics): detect postcode and slot overlaps in setup readiness

Two zones claiming the same postcode range is a silent dispatch bug —
whichever sorts first wins. Same for two active slots on one truck and
weekday, which double-counts capacity. Both are now surfaced, along with
backwards ranges and trucks missing a capacity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Global search across every setup entity

**Files:**
- Modify: `src/features/logistics/lib/setup-model.ts`
- Test: `src/features/logistics/tests/unit/setup-model.test.ts`

**Interfaces:**
- Consumes: `SetupSnapshot`, `SetupEntity` from Task 1.
- Produces:
  ```ts
  export type SearchHit = {
    entity: SetupEntity;
    /** The record to select in the list pane; null selects the entity only. */
    recordId: string | null;
    label: string;
    /** Why it matched, shown as secondary text. */
    context: string;
  };

  export function searchSetup(snapshot: SetupSnapshot, query: string): SearchHit[];
  ```

- [ ] **Step 1: Write the failing test**

Append to `src/features/logistics/tests/unit/setup-model.test.ts`:

```ts
import { searchSetup } from "../../lib/setup-model";

describe("searchSetup", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSetup(healthy(), "   ")).toEqual([]);
  });

  it("matches a truck by name, case-insensitively", () => {
    const hits = searchSetup(healthy(), "canter");
    expect(hits[0]).toMatchObject({ entity: "trucks", label: "Canter 01" });
  });

  it("matches a truck by code", () => {
    expect(searchSetup(healthy(), "T1")[0].entity).toBe("trucks");
  });

  it("matches a zone by name", () => {
    const hits = searchSetup(healthy(), "Zone 1");
    expect(hits.some((h) => h.entity === "zones")).toBe(true);
  });

  it("resolves a bare postcode to the zone whose range contains it", () => {
    const hits = searchSetup(healthy(), "47100");
    const hit = hits.find((h) => h.entity === "postcodes");
    expect(hit?.recordId).toBe("zone-1".padEnd(36, "0"));
    expect(hit?.context).toContain("47000");
  });

  it("does not resolve a postcode outside every range", () => {
    const hits = searchSetup(healthy(), "99999");
    expect(hits.some((h) => h.entity === "postcodes")).toBe(false);
  });

  it("matches a blocked date by its reason", () => {
    const s = healthy();
    s.blocks = [{
      id: "block-1".padEnd(36, "0"), organization_id: "org", block_date: "2026-08-30",
      truck_id: null, reason: "Hari Raya Haji", created_by: null, created_at: "",
    }];
    expect(searchSetup(s, "raya")[0].entity).toBe("blocks");
  });

  it("ignores archived records", () => {
    const s = healthy();
    s.trucks = [truck({ id: s.trucks[0].id, name: "Canter 01", is_active: false })];
    expect(searchSetup(s, "canter")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/setup-model.test.ts`
Expected: FAIL — `searchSetup is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/features/logistics/lib/setup-model.ts`:

```ts
export type SearchHit = {
  entity: SetupEntity;
  recordId: string | null;
  label: string;
  context: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * One box over all seven entities. A bare five-digit number is treated as a
 * postcode and resolved to the zone that owns it — the question the office
 * gets asked on the phone most often.
 */
export function searchSetup(snapshot: SetupSnapshot, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const hits: SearchHit[] = [];
  const liveZones = snapshot.zones.filter((z) => z.is_active);
  const liveTrucks = snapshot.trucks.filter((t) => t.is_active);

  for (const truck of liveTrucks) {
    if (truck.name.toLowerCase().includes(q) || truck.code.toLowerCase().includes(q)) {
      hits.push({
        entity: "trucks",
        recordId: truck.id,
        label: truck.name,
        context: `Truck · ${truck.code}`,
      });
    }
  }

  for (const zone of liveZones) {
    if (zone.name.toLowerCase().includes(q)) {
      hits.push({
        entity: "zones",
        recordId: zone.id,
        label: zone.name,
        context: "Zone",
      });
    }
  }

  if (/^\d{5}$/.test(q)) {
    for (const range of snapshot.ranges) {
      if (q < range.postcode_start || q > range.postcode_end) continue;
      const zone = liveZones.find((z) => z.id === range.zone_id);
      if (!zone) continue;
      hits.push({
        entity: "postcodes",
        recordId: zone.id,
        label: `${q} is in ${zone.name}`,
        context: `Range ${range.postcode_start}–${range.postcode_end}`,
      });
    }
  }

  for (const block of snapshot.blocks) {
    const reason = block.reason ?? "";
    if (!reason.toLowerCase().includes(q) && !block.block_date.includes(q)) continue;
    const truckName = block.truck_id
      ? (snapshot.trucks.find((t) => t.id === block.truck_id)?.name ?? "Unknown truck")
      : "All trucks";
    hits.push({
      entity: "blocks",
      recordId: block.id,
      label: reason === "" ? block.block_date : `${block.block_date} · ${reason}`,
      context: `Blocked · ${truckName}`,
    });
  }

  for (const bay of snapshot.bays) {
    if (!bay.name.toLowerCase().includes(q)) continue;
    hits.push({ entity: "bays", recordId: bay.id, label: bay.name, context: "Bay" });
  }

  if (snapshot.facility && (
    snapshot.facility.name.toLowerCase().includes(q) ||
    snapshot.facility.postcode.includes(q)
  )) {
    hits.push({
      entity: "factory",
      recordId: snapshot.facility.id,
      label: snapshot.facility.name,
      context: `Factory · ${snapshot.facility.postcode}`,
    });
  }

  for (const slot of snapshot.slots) {
    if (!slot.is_active) continue;
    const truck = liveTrucks.find((t) => t.id === slot.truck_id);
    if (!truck) continue;
    const label = `${WEEKDAYS[slot.weekday]} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
    if (!label.toLowerCase().includes(q)) continue;
    hits.push({
      entity: "slots",
      recordId: slot.truck_id,
      label,
      context: `Slot · ${truck.name}`,
    });
  }

  return hits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/setup-model.test.ts`
Expected: PASS — 23 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/setup-model.ts src/features/logistics/tests/unit/setup-model.test.ts
git commit -m "$(cat <<'EOF'
feat(logistics): one search box across every delivery setup entity

Matches trucks, zones, bays, slots, blocked dates and the factory. A bare
five-digit number resolves to the zone whose postcode range contains it,
which is the question the office answers on the phone most often.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Truck capacity and bay become editable

**Files:**
- Modify: `src/features/orders/types.ts:345-350` (`TruckInputSchema`)
- Modify: `src/features/orders/server/schedule-actions.ts:203-279` (`createTruck`, `updateTruck`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export const TruckInputSchema = z.object({
    name: z.string().min(1).max(100),
    code: z.string().min(1).max(20),
    isActive: z.boolean().default(true),
    capacityKg: z.number().int().positive().nullable().default(null),
    bayId: z.string().uuid().nullable().default(null),
  });
  ```
  `createTruck(orgSlug, input)` and `updateTruck(orgSlug, id, input)` keep their existing
  `{ ok: true; data: Truck } | { ok: false; message: string }` result shape and now
  persist `capacity_kg` and `bay_id`.

- [ ] **Step 1: Read the current action bodies**

Run: `sed -n 203,279p src/features/orders/server/schedule-actions.ts`
Note the exact shape used to build the insert/update payload — the next step
must extend it, not replace it. `capacity_kg` and `bay_id` already exist as
columns on `trucks` (see `src/features/orders/types.ts:83-95`), so no migration
is needed.

- [ ] **Step 2: Extend the schema**

In `src/features/orders/types.ts`, replace:

```ts
export const TruckInputSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  isActive: z.boolean().default(true),
});
```

with:

```ts
export const TruckInputSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  isActive: z.boolean().default(true),
  /** null = not recorded; load planning skips the overbooking warning. */
  capacityKg: z.number().int().positive().nullable().default(null),
  /** null = unassigned; the bay can also be set from the Bays panel. */
  bayId: z.string().uuid().nullable().default(null),
});
```

- [ ] **Step 3: Persist the two fields in both actions**

In `src/features/orders/server/schedule-actions.ts`, in `createTruck`, add to the
object passed to `.insert({ … })`:

```ts
      capacity_kg: parsed.data.capacityKg,
      bay_id: parsed.data.bayId,
```

and in `updateTruck`, add the same two lines to the object passed to `.update({ … })`.
Use whatever the local name for the parsed input is in that file (it is `parsed.data`
if the file follows the `safeParse` convention used by the other actions — match the
surrounding code exactly rather than assuming).

- [ ] **Step 4: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: PASS, no errors. If `delivery-client.tsx` errors because `TruckForm`
does not send the new fields, that is expected only if the schema fields lack
`.default(null)` — they have defaults, so existing callers stay valid.

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/types.ts src/features/orders/server/schedule-actions.ts
git commit -m "$(cat <<'EOF'
feat(seller): let the truck form set capacity and bay

trucks.capacity_kg and trucks.bay_id already existed but no action wrote
them — capacity was unreachable from the UI and the bay could only be set
from the Bays panel. Both are now part of TruckInputSchema, defaulting to
null so existing callers are unaffected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Readiness panel component

**Files:**
- Create: `src/features/logistics/components/setup/readiness-panel.tsx`

**Interfaces:**
- Consumes: `SetupIssue`, `IssueSeverity`, `SetupEntity` from `../../lib/setup-model`.
- Produces:
  ```ts
  export function ReadinessPanel(props: {
    issues: SetupIssue[];
    onFix: (target: { entity: SetupEntity; recordId: string | null }) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the component**

Create `src/features/logistics/components/setup/readiness-panel.tsx`:

```tsx
"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IssueSeverity, SetupEntity, SetupIssue } from "../../lib/setup-model";

const SEVERITY_STYLE: Record<IssueSeverity, { icon: typeof Info; className: string; label: string }> = {
  blocker: { icon: OctagonAlert, className: "text-destructive", label: "Blocks orders" },
  warning: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-500", label: "Needs attention" },
  info: { icon: Info, className: "text-muted-foreground", label: "Optional" },
};

export function ReadinessPanel({
  issues,
  onFix,
}: {
  issues: SetupIssue[];
  onFix: (target: { entity: SetupEntity; recordId: string | null }) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-medium">Delivery setup is ready</p>
          <p className="text-sm text-muted-foreground">
            Every zone has postcodes and a truck, and every truck has slots.
          </p>
        </div>
      </div>
    );
  }

  const blockers = issues.filter((i) => i.severity === "blocker").length;

  return (
    <section aria-label="Setup readiness" className="rounded-lg border">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <h2 className="font-semibold">
          {issues.length} {issues.length === 1 ? "issue" : "issues"} to fix
        </h2>
        {blockers > 0 ? (
          <span className="text-sm text-destructive">
            {blockers} {blockers === 1 ? "blocks" : "block"} customer orders
          </span>
        ) : null}
      </header>
      <ul className="divide-y">
        {issues.map((issue) => {
          const style = SEVERITY_STYLE[issue.severity];
          const Icon = style.icon;
          return (
            <li
              key={issue.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <Icon className={cn("h-4 w-4 shrink-0", style.className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{issue.title}</p>
                <p className="text-sm text-muted-foreground">{issue.detail}</p>
              </div>
              <Button
                variant={issue.severity === "blocker" ? "default" : "outline"}
                size="sm"
                className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                onClick={() => onFix(issue.target)}
              >
                Fix
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS. If `cn` is not exported from `@/lib/utils`, run
`grep -rn "export function cn" src/lib/` and import from wherever it actually lives.

- [ ] **Step 3: Commit**

```bash
git add src/features/logistics/components/setup/readiness-panel.tsx
git commit -m "$(cat <<'EOF'
feat(seller): add the delivery setup readiness panel

Renders derived issues newest-severity-first, each with a Fix button that
selects the record that needs changing. Shows a clean state rather than an
empty box when there is nothing wrong.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Console shell — rail, list, detail

**Files:**
- Create: `src/features/logistics/components/setup/entity-rail.tsx`
- Create: `src/features/logistics/components/setup/record-list.tsx`

**Interfaces:**
- Consumes: `SetupEntity`, `SetupIssue` from `../../lib/setup-model`.
- Produces:
  ```ts
  export const ENTITY_LABELS: Record<SetupEntity, string>;   // entity-rail.tsx

  export function EntityRail(props: {
    selected: SetupEntity;
    counts: Record<SetupEntity, number>;
    issueCounts: Record<SetupEntity, number>;
    onSelect: (entity: SetupEntity) => void;
  }): JSX.Element;

  export type ListRow = {                                     // record-list.tsx
    id: string;
    label: string;
    secondary: string;
    /** Rendered as a small chip on the right, e.g. "no zone". */
    badge?: { text: string; tone: "warning" | "muted" };
    archived?: boolean;
  };

  export function RecordList(props: {
    rows: ListRow[];
    selectedId: string | null;
    emptyMessage: string;
    addLabel: string;
    onSelect: (id: string) => void;
    onAdd: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the entity rail**

Create `src/features/logistics/components/setup/entity-rail.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { SetupEntity } from "../../lib/setup-model";

export const ENTITY_LABELS: Record<SetupEntity, string> = {
  zones: "Zones",
  trucks: "Trucks",
  slots: "Slots",
  blocks: "Blocked dates",
  factory: "Factory",
  bays: "Bays",
  postcodes: "Zone postcodes",
};

const ORDER: SetupEntity[] = [
  "zones", "trucks", "slots", "blocks", "factory", "bays", "postcodes",
];

export function EntityRail({
  selected,
  counts,
  issueCounts,
  onSelect,
}: {
  selected: SetupEntity;
  counts: Record<SetupEntity, number>;
  issueCounts: Record<SetupEntity, number>;
  onSelect: (entity: SetupEntity) => void;
}) {
  return (
    <nav aria-label="Setup sections" className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
      {ORDER.map((entity) => {
        const isSelected = entity === selected;
        const issues = issueCounts[entity] ?? 0;
        return (
          <button
            key={entity}
            type="button"
            aria-current={isSelected ? "page" : undefined}
            onClick={() => onSelect(entity)}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-md px-3 text-sm",
              "lg:w-full",
              isSelected
                ? "bg-background font-semibold shadow-sm"
                : "text-muted-foreground hover:bg-background/60",
            )}
          >
            <span className="whitespace-nowrap">{ENTITY_LABELS[entity]}</span>
            <span className="flex items-center gap-1.5">
              {issues > 0 ? (
                <span
                  aria-label={`${issues} issues`}
                  className="h-1.5 w-1.5 rounded-full bg-amber-500"
                />
              ) : null}
              <span className="tabular-nums text-xs text-muted-foreground">
                {counts[entity] ?? 0}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write the record list**

Create `src/features/logistics/components/setup/record-list.tsx`:

```tsx
"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type ListRow = {
  id: string;
  label: string;
  secondary: string;
  badge?: { text: string; tone: "warning" | "muted" };
  archived?: boolean;
};

export function RecordList({
  rows,
  selectedId,
  emptyMessage,
  addLabel,
  onSelect,
  onAdd,
}: {
  rows: ListRow[];
  selectedId: string | null;
  emptyMessage: string;
  addLabel: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 divide-y overflow-y-auto">
        {rows.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</li>
        ) : (
          rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                aria-current={row.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left",
                  row.id === selectedId ? "bg-muted" : "hover:bg-muted/50",
                  row.archived && "opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.secondary}
                  </span>
                </span>
                {row.badge ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      row.badge.tone === "warning"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-500"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {row.badge.text}
                  </span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="border-t p-2">
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          {addLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/logistics/components/setup/entity-rail.tsx src/features/logistics/components/setup/record-list.tsx
git commit -m "$(cat <<'EOF'
feat(seller): add entity rail and record list for the setup console

The rail carries live counts and an issue dot per section; the list is a
44px-row picker with an inline add row. Both scroll horizontally below
the lg breakpoint so the console collapses cleanly on a tablet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Detail forms without dialogs

**Files:**
- Create: `src/features/logistics/components/setup/detail-forms.tsx`

**Interfaces:**
- Consumes: `DeliveryZone`, `Truck`, `DeliverySlot`, `ScheduleBlock` from `@/features/orders/types`; `Bay` from `../../types`.
- Produces:
  ```ts
  export const WEEKDAY_LABELS: readonly string[];

  export function ZoneFields(props: { zone?: DeliveryZone }): JSX.Element;
  export function TruckFields(props: { truck?: Truck; bays: Bay[] }): JSX.Element;
  export function SlotFields(props: { slot?: DeliverySlot; trucks: Truck[]; defaultTruckId: string }): JSX.Element;
  export function BlockFields(props: { trucks: Truck[] }): JSX.Element;
  ```
  Every component renders only `<Label>`/`<Input>`/`<select>` fields with `name`
  attributes matching the existing Zod schemas — no `<form>` element, no submit
  button. The console owns the `<form>` and the sticky save bar.

- [ ] **Step 1: Write the component file**

Create `src/features/logistics/components/setup/detail-forms.tsx`. Field names must
match the existing schemas exactly: zone → `name`, `displayOrder`, `isActive`;
truck → `name`, `code`, `isActive`, `capacityKg`, `bayId`; slot → `truckId`,
`weekday`, `startTime`, `endTime`, `maxOrders`, `isActive`; block → `blockDate`,
`truckId`, `reason`.

```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Bay } from "../../types";
import type { DeliverySlot, DeliveryZone, Truck } from "@/features/orders/types";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const selectClass =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function ActiveToggle({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" name="isActive" defaultChecked={defaultChecked} className="h-4 w-4" />
      Active
    </label>
  );
}

export function ZoneFields({ zone }: { zone?: DeliveryZone }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="zone-name">Name</Label>
        <Input id="zone-name" name="name" defaultValue={zone?.name ?? ""} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="zone-order">Display order</Label>
        <Input
          id="zone-order"
          name="displayOrder"
          type="number"
          defaultValue={zone?.display_order ?? 0}
        />
      </div>
      <div className="flex items-end">
        <ActiveToggle defaultChecked={zone?.is_active ?? true} />
      </div>
    </div>
  );
}

export function TruckFields({ truck, bays }: { truck?: Truck; bays: Bay[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="truck-name">Name</Label>
        <Input id="truck-name" name="name" defaultValue={truck?.name ?? ""} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-code">Code</Label>
        <Input id="truck-code" name="code" defaultValue={truck?.code ?? ""} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-capacity">Capacity kg (blank = not recorded)</Label>
        <Input
          id="truck-capacity"
          name="capacityKg"
          type="number"
          min="1"
          defaultValue={truck?.capacity_kg ?? ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-bay">Bay</Label>
        <select
          id="truck-bay"
          name="bayId"
          defaultValue={truck?.bay_id ?? ""}
          className={selectClass}
        >
          <option value="">Unassigned</option>
          {bays.map((bay) => (
            <option key={bay.id} value={bay.id}>{bay.name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-end sm:col-span-2">
        <ActiveToggle defaultChecked={truck?.is_active ?? true} />
      </div>
    </div>
  );
}

export function SlotFields({
  slot,
  trucks,
  defaultTruckId,
}: {
  slot?: DeliverySlot;
  trucks: Truck[];
  defaultTruckId: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="slot-truck">Truck</Label>
        <select
          id="slot-truck"
          name="truckId"
          defaultValue={slot?.truck_id ?? defaultTruckId}
          className={selectClass}
        >
          {trucks.map((truck) => (
            <option key={truck.id} value={truck.id}>{truck.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-weekday">Weekday</Label>
        <select
          id="slot-weekday"
          name="weekday"
          defaultValue={String(slot?.weekday ?? 1)}
          className={selectClass}
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <option key={label} value={index}>{label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-start">Start time</Label>
        <Input
          id="slot-start"
          name="startTime"
          type="time"
          defaultValue={slot?.start_time?.slice(0, 5) ?? "09:00"}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-end">End time</Label>
        <Input
          id="slot-end"
          name="endTime"
          type="time"
          defaultValue={slot?.end_time?.slice(0, 5) ?? "12:00"}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-max">Max orders (blank = unlimited)</Label>
        <Input
          id="slot-max"
          name="maxOrders"
          type="number"
          min="1"
          defaultValue={slot?.max_orders ?? ""}
        />
      </div>
      <div className="flex items-end">
        <ActiveToggle defaultChecked={slot?.is_active ?? true} />
      </div>
    </div>
  );
}

export function BlockFields({ trucks }: { trucks: Truck[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="block-date">Date</Label>
        <Input id="block-date" name="blockDate" type="date" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="block-truck">Truck</Label>
        <select id="block-truck" name="truckId" defaultValue="all" className={selectClass}>
          <option value="all">All trucks</option>
          {trucks.map((truck) => (
            <option key={truck.id} value={truck.id}>{truck.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="block-reason">Reason</Label>
        <Input id="block-reason" name="reason" placeholder="e.g. Hari Raya Haji" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/logistics/components/setup/detail-forms.tsx
git commit -m "$(cat <<'EOF'
feat(seller): extract delivery setup detail fields from the dialogs

Field bodies only — no form element, no submit button — so the console can
own a single sticky save bar instead of four modals. Truck gains the
capacity and bay fields the schema now accepts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The console shell

**Files:**
- Create: `src/features/logistics/components/setup/setup-console.tsx`

**Interfaces:**
- Consumes: `EntityRail` + `ENTITY_LABELS` (Task 6), `RecordList` + `ListRow` (Task 6),
  `ReadinessPanel` (Task 5), `ZoneFields`/`TruckFields`/`SlotFields`/`BlockFields` (Task 7),
  `findIssues`/`searchSetup`/`SetupSnapshot`/`SetupEntity`/`SetupIssue` (Tasks 1–3).
- Produces:
  ```ts
  export type ConsoleHandlers = {
    submit: (entity: SetupEntity, recordId: string | null, form: FormData) => Promise<void>;
    archive: (entity: SetupEntity, recordId: string, archived: boolean) => Promise<void>;
    remove: (entity: SetupEntity, recordId: string) => Promise<void>;
    toggleTruckZone: (truckId: string, zoneId: string, checked: boolean) => Promise<void>;
  };

  export function SetupConsole(props: {
    snapshot: SetupSnapshot;
    canEdit: boolean;
    handlers: ConsoleHandlers;
    /** Rendered in the detail pane for factory / bays / postcodes. */
    panels: Record<"factory" | "bays" | "postcodes", React.ReactNode>;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the shell**

Create `src/features/logistics/components/setup/setup-console.tsx`. Key behaviours,
all of which must be present:

- `selected` state is `{ entity: SetupEntity; recordId: string | null }`. `recordId: null`
  means "creating a new record"; the detail pane renders empty fields.
- `query` state drives `searchSetup`; when non-empty, the middle pane shows hits
  across all entities instead of the selected entity's rows. Clicking a hit sets
  `selected` to that hit's `{ entity, recordId }` and clears the query.
- `issues` is `useMemo(() => findIssues(snapshot), [snapshot])`. `issueCounts` is
  derived by counting issues per `target.entity`.
- Layout: `grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1.2fr)]`.
  Below `lg`, the detail pane is hidden unless `recordId !== null` or the user is
  creating, in which case the list is hidden and a `‹ Back` button appears — the
  drill-down. Use a `showDetailOnSmall` boolean, not CSS-only hiding, so focus order
  stays correct.
- The detail pane wraps the field components in one `<form>` whose `onSubmit`
  builds `FormData` and calls `handlers.submit(entity, recordId, formData)`.
- The sticky save bar is `sticky bottom-0 border-t bg-background p-3` and holds:
  a muted "Last edited …" line when the record exists, an **Archive** button
  (primary destructive path), an overflow menu item **Delete permanently** that
  keeps the existing `confirm()` call, and the **Save** submit button. When
  `canEdit` is false, render the fields as read-only text and hide the bar entirely.
- Trucks get an extra "Zones served" block above the save bar: one checkbox per
  active zone calling `handlers.toggleTruckZone`. This is saved immediately (it is
  a join table, not part of the truck form) — label it "Saved automatically".
- `factory`, `bays` and `postcodes` render `props.panels[entity]` in the detail pane
  and show no list pane.

Build the `ListRow[]` for each entity from the snapshot:

```tsx
function rowsFor(entity: SetupEntity, snapshot: SetupSnapshot, issues: SetupIssue[]): ListRow[] {
  const hasIssue = (id: string) => issues.some((i) => i.target.recordId === id);
  switch (entity) {
    case "zones":
      return snapshot.zones.map((z) => ({
        id: z.id,
        label: z.name,
        secondary: `Order ${z.display_order}`,
        badge: hasIssue(z.id) ? { text: "needs setup", tone: "warning" as const } : undefined,
        archived: !z.is_active,
      }));
    case "trucks":
      return snapshot.trucks.map((t) => ({
        id: t.id,
        label: t.name,
        secondary: t.capacity_kg === null ? t.code : `${t.code} · ${t.capacity_kg} kg`,
        badge: hasIssue(t.id) ? { text: "needs setup", tone: "warning" as const } : undefined,
        archived: !t.is_active,
      }));
    case "slots":
      return snapshot.slots.map((s) => ({
        id: s.id,
        label: `${WEEKDAY_LABELS[s.weekday]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`,
        secondary: `${snapshot.trucks.find((t) => t.id === s.truck_id)?.name ?? "Unknown truck"} · ${s.max_orders ?? "unlimited"}`,
        archived: !s.is_active,
      }));
    case "blocks":
      return snapshot.blocks.map((b) => ({
        id: b.id,
        label: b.block_date,
        secondary: `${b.truck_id ? (snapshot.trucks.find((t) => t.id === b.truck_id)?.name ?? "Unknown truck") : "All trucks"} · ${b.reason ?? "no reason"}`,
      }));
    default:
      return [];
  }
}
```

Note the `slots` case keys rows by slot id, but `SetupIssue.target.recordId` for
`truck-no-slots` and `slot-overlap` is a **truck** id. The Fix handler must
therefore special-case `slots`: when the target recordId does not match any slot,
select the entity and filter the list to that truck rather than selecting a row.
Implement that as a `truckFilter` state on the console, cleared whenever the user
changes entity manually.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/logistics/components/setup/setup-console.tsx
git commit -m "$(cat <<'EOF'
feat(seller): add the delivery setup console shell

Rail, list and always-open detail pane with one sticky save bar, replacing
four dialogs. Below lg the panes become a drill-down with a real back path,
so nothing covers the record being read on a tablet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire the page up

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/delivery/delivery-client.tsx` (replaces the
  `Tabs` render and the three `Dialog` blocks; keeps every existing `handle*` function
  and all state)

**Interfaces:**
- Consumes: `SetupConsole`, `ConsoleHandlers` (Task 8); `findIssues` (Tasks 1–2).
- Produces: nothing new. The page's props are unchanged.

- [ ] **Step 1: Replace the render tree**

Keep the whole top half of the file — state, `fail`, and every `handle*` function
— and delete only from `return (` to the closing `);`, plus the now-unused
`ZoneForm` / `TruckForm` / `SlotForm` components at the bottom and the `Tabs`,
`Table`, `Dialog` imports.

The new return:

```tsx
  const snapshot: SetupSnapshot = {
    zones, trucks, truckZones, slots, blocks, facility, bays, ranges,
  };

  const handlers: ConsoleHandlers = {
    submit: async (entity, recordId, form) => {
      if (entity === "zones") return handleZoneSubmitFromData(recordId, form);
      if (entity === "trucks") return handleTruckSubmitFromData(recordId, form);
      if (entity === "slots") return handleSlotSubmitFromData(recordId, form);
      if (entity === "blocks") return handleBlockSubmitFromData(form);
    },
    archive: handleArchive,
    remove: handleRemove,
    toggleTruckZone: async (truckId, zoneId, checked) => {
      const truck = trucks.find((t) => t.id === truckId);
      if (truck) await handleToggleTruckZone(truck, zoneId, checked);
    },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Delivery Setup</h1>
        <p className="text-muted-foreground">
          Zones, trucks, weekly slots, and blocked dates for the delivery schedule
        </p>
      </div>

      <SetupConsole
        snapshot={snapshot}
        canEdit={role === "owner" || role === "org_admin"}
        handlers={handlers}
        panels={{
          factory: (
            <FacilityPanel
              organizationSlug={organizationSlug}
              facility={facility}
              canEdit={role === "owner" || role === "org_admin"}
              onSaved={handleFacilitySaved}
            />
          ),
          bays: (
            <BaysPanel
              organizationSlug={organizationSlug}
              facilityId={facility?.id ?? null}
              bays={bays}
              trucks={trucks}
              onBayCreated={handleBayCreated}
              onBayDeleted={handleBayDeleted}
              onTruckBayChanged={handleTruckBayChanged}
            />
          ),
          postcodes: (
            <PostcodeRangesPanel
              organizationSlug={organizationSlug}
              zones={zones}
              ranges={ranges}
              onRangeAdded={handleRangeAdded}
              onRangeDeleted={handleRangeDeleted}
            />
          ),
        }}
      />
    </div>
  );
```

- [ ] **Step 2: Convert the four submit handlers to take FormData directly**

The existing handlers take a `React.FormEvent` and read `new FormData(e.currentTarget)`.
Change each signature to `(recordId: string | null, form: FormData)` and drop the
`e.preventDefault()` / `new FormData(...)` lines; the console does both. Look up the
record being edited by `recordId` instead of by dialog state, e.g. for zones:

```tsx
  async function handleZoneSubmitFromData(recordId: string | null, form: FormData) {
    const editing = recordId ? zones.find((z) => z.id === recordId) : undefined;
    const input = {
      name: String(form.get("name") ?? ""),
      displayOrder: Number(form.get("displayOrder") ?? 0),
      isActive: form.get("isActive") === "on",
    };
    const result = editing
      ? await updateZone(organizationSlug, editing.id, input)
      : await createZone(organizationSlug, input);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setZones((prev) =>
      editing
        ? prev.map((z) => (z.id === result.data.id ? result.data : z))
        : [...prev, result.data],
    );
    toast({ title: editing ? "Zone updated" : "Zone created" });
  }
```

For trucks, also read the two new fields:

```tsx
    const capacityRaw = String(form.get("capacityKg") ?? "").trim();
    const bayRaw = String(form.get("bayId") ?? "");
    const input = {
      name: String(form.get("name") ?? ""),
      code: String(form.get("code") ?? ""),
      isActive: form.get("isActive") === "on",
      capacityKg: capacityRaw === "" ? null : Number(capacityRaw),
      bayId: bayRaw === "" ? null : bayRaw,
    };
```

For blocks, keep the existing `truckId === "all" ? null : truckId` mapping.

- [ ] **Step 3: Add the archive and remove handlers**

Archive is an update with `isActive` flipped — no new server action. Add:

```tsx
  async function handleArchive(entity: SetupEntity, recordId: string, archived: boolean) {
    if (entity === "zones") {
      const zone = zones.find((z) => z.id === recordId);
      if (!zone) return;
      const result = await updateZone(organizationSlug, zone.id, {
        name: zone.name,
        displayOrder: zone.display_order,
        isActive: !archived,
      });
      if (!result.ok) return fail(result.message);
      setZones((prev) => prev.map((z) => (z.id === result.data.id ? result.data : z)));
    } else if (entity === "trucks") {
      const truck = trucks.find((t) => t.id === recordId);
      if (!truck) return;
      const result = await updateTruck(organizationSlug, truck.id, {
        name: truck.name,
        code: truck.code,
        isActive: !archived,
        capacityKg: truck.capacity_kg,
        bayId: truck.bay_id,
      });
      if (!result.ok) return fail(result.message);
      setTrucks((prev) => prev.map((t) => (t.id === result.data.id ? result.data : t)));
    } else if (entity === "slots") {
      const slot = slots.find((s) => s.id === recordId);
      if (!slot) return;
      const result = await updateSlot(organizationSlug, slot.id, {
        truckId: slot.truck_id,
        weekday: slot.weekday,
        startTime: slot.start_time.slice(0, 5),
        endTime: slot.end_time.slice(0, 5),
        maxOrders: slot.max_orders,
        isActive: !archived,
      });
      if (!result.ok) return fail(result.message);
      setSlots((prev) => prev.map((s) => (s.id === result.data.id ? result.data : s)));
    } else {
      return;
    }

    toast({
      title: archived ? "Archived" : "Restored",
      description: archived ? "It is hidden from live views." : undefined,
      action: (
        <ToastAction altText="Undo" onClick={() => handleArchive(entity, recordId, !archived)}>
          Undo
        </ToastAction>
      ),
    });
  }
```

Import `ToastAction` from `@/components/ui/toast`. If that export does not exist,
run `grep -rn "ToastAction" src/components/ui/` and adapt; if the repo's toast has
no action slot, fall back to a plain toast whose description reads
"Archived. Open the record to restore it." and note the omission in the commit body.

`handleRemove` dispatches to the four existing `handleDelete*` functions, which
already carry their own `confirm()`.

- [ ] **Step 4: Typecheck and run the full unit suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS on both. The existing `dashboard-shell-model` and `timeline-model`
suites must still pass — this task touches neither.

- [ ] **Step 5: Verify in the browser**

Start the dev server through the preview tooling (not `npm run dev` in a shell) and
open `/<organizationSlug>/delivery`. Confirm, using `read_page` rather than
screenshots:

1. The readiness panel lists at least the seeded issues, and each Fix button
   selects the matching record.
2. Selecting a truck shows capacity and bay fields; saving persists them (reload
   and confirm the value survives).
3. No dialog opens anywhere on the page.
4. At a 768px viewport, the detail pane becomes a drill-down with a working back
   button.
5. Typing `47100` (or a postcode inside a seeded range) in the search box returns
   the owning zone.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/delivery/delivery-client.tsx"
git commit -m "$(cat <<'EOF'
feat(seller): rebuild Delivery Setup as a console with a readiness panel

Seven flat tabs of tables and four dialogs become a rail, a searchable
list and an always-open detail pane with one sticky save bar. The page now
leads with what is misconfigured — zones without postcodes, trucks without
zones or slots, ranges two zones both claim — each with a Fix button that
selects the record to change.

Delete is no longer the primary action: zones, trucks and slots archive by
flipping is_active, with undo, matching the products catalog. Hard delete
stays behind an overflow menu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage.** The chosen scope was: console shell (Tasks 6–9), readiness panel
(Tasks 1, 2, 5), global search (Task 3), truck capacity and bay in the detail form
(Task 4), archive with undo replacing hard delete (Task 9, step 3). All five are
covered. Explicitly **out of scope** and not planned here: bulk slot creation, the
Malaysian holiday calendar, impact preview ("affects N booked orders" — needs a new
order count query), zone colour tokens, and printable schedules.

**Known sharp edges the implementer must not smooth over silently.**

1. `SetupIssue.target.recordId` for `truck-no-slots` and `slot-overlap` is a truck
   id, not a slot id. Task 8 step 1 handles this with a `truckFilter`; if that is
   dropped, the Fix button silently selects nothing.
2. Archiving a slot writes `startTime`/`endTime` back as `HH:MM` because
   `SlotInputSchema` requires that shape, while the row holds `HH:MM:SS`. The
   `.slice(0, 5)` in `handleArchive` is load-bearing.
3. `handleArchive`'s undo re-calls itself with the flag inverted. That is
   deliberate — restore is the same operation — but means a failed restore surfaces
   through `fail()` and no second toast.
4. Task 4 tells the implementer to match the surrounding `safeParse` convention
   rather than assuming the local variable name in `schedule-actions.ts`. Read the
   function before editing it.
