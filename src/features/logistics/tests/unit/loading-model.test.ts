import { describe, expect, it } from "vitest";
import type { DispatchBoardData, DispatchTicket } from "../../types";
import { buildLoadQueue, truckSummaries } from "../../lib/loading-model";

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
