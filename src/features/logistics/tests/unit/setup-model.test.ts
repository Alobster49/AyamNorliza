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
