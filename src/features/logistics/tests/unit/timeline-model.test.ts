import { describe, expect, it } from "vitest";
import type { DispatchBoardData, DispatchTicket } from "../../types";
import { buildTimeline, minutesOf } from "../../lib/timeline-model";

const DATE = "2026-08-20";
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
    zones: [{ id: "zone-1", organization_id: "org", name: "Zone 1", display_order: 0, is_active: true, created_by: null, created_at: "", updated_at: "", version: 1 }],
    ranges: [{ id: "r1", organization_id: "org", zone_id: "zone-1", postcode_start: "82000", postcode_end: "82999", created_by: null, created_at: "" }],
    truckZones: [{ truck_id: t.id, zone_id: "zone-1", organization_id: "org" }],
    slots: [{ id: "slot-1", organization_id: "org", truck_id: t.id, weekday: WEEKDAY, start_time: "08:00:00", end_time: "09:00:00", max_orders: 10, is_active: true, created_by: null, created_at: "", updated_at: "", version: 1 }],
    blocks: [],
    runs: [],
    orders: [],
    ...over,
  };
}

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

  it("stacks overlapping blocks into separate lanes", () => {
    const data = baseData();
    const truckId = data.trucks[0]!.id;
    data.orders = [
      order({ assignment_source: "auto", truck_id: truckId }),
      order({ assignment_source: "auto", truck_id: truckId }),
    ];
    const row = buildTimeline(data, DATE, null).rows[0]!;
    expect(row.laneCount).toBe(2);
    expect(row.blocks.map((b) => b.lane).sort()).toEqual([0, 1]);
  });

  it("reuses lane 0 for blocks whose slots do not overlap", () => {
    const data = baseData();
    const truckId = data.trucks[0]!.id;
    data.slots = [
      data.slots[0]!,
      { ...data.slots[0]!, id: "slot-2", start_time: "10:00:00", end_time: "11:00:00" },
    ];
    data.orders = [
      order({ assignment_source: "auto", truck_id: truckId }),
      order({ assignment_source: "auto", truck_id: truckId, slot_id: "slot-2" }),
    ];
    const row = buildTimeline(data, DATE, null).rows[0]!;
    expect(row.laneCount).toBe(1);
    expect(row.blocks.map((b) => b.lane)).toEqual([0, 0]);
  });

  it("falls back to a 06:00-14:00 window when nothing is scheduled", () => {
    const view = buildTimeline(baseData(), DATE, null);
    expect(view.windowStart).toBe(360);
    expect(view.windowEnd).toBe(840);
    expect(view.hours[0]).toBe(6);
  });
});
