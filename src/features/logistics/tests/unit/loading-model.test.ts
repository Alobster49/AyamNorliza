import { describe, expect, it } from "vitest";
import type { DispatchBoardData, DispatchTicket } from "../../types";
import { buildLoadBoard, buildLoadQueue, truckSummaries } from "../../lib/loading-model";

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
    truck_id: "truck-x", run_id: null, run_sequence: null, postcode: "82000",
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

function slot(id: string, start: string, truckId: string) {
  return {
    id, organization_id: "org", truck_id: truckId, weekday: WEEKDAY,
    start_time: start, end_time: start, max_orders: 10, is_active: true,
    created_by: null, created_at: "", updated_at: "", version: 1,
  };
}

/** Three orders on 06:00 / 07:00 / 08:00, all on the board's only truck. */
function routeData() {
  const data = baseData();
  const truckId = data.trucks[0]!.id;
  data.slots = [
    slot("slot-1", "06:00:00", truckId),
    slot("slot-2", "07:00:00", truckId),
    slot("slot-3", "08:00:00", truckId),
  ];
  data.orders = [
    order({ assignment_source: "auto", truck_id: truckId, slot_id: "slot-2", customer: { name: "Second" }, items: [{ quantity: 1, warehouse_weight_kg: 20, warehouse_pieces: 1, final_weight_kg: null, is_cancelled: false, product: { name: "Ayam" } }] }),
    order({ assignment_source: "auto", truck_id: truckId, slot_id: "slot-1", customer: { name: "First" }, items: [{ quantity: 1, warehouse_weight_kg: 10, warehouse_pieces: 1, final_weight_kg: null, is_cancelled: false, product: { name: "Ayam" } }] }),
    order({ assignment_source: "auto", truck_id: truckId, slot_id: "slot-3", customer: { name: "Third" }, items: [{ quantity: 1, warehouse_weight_kg: 30, warehouse_pieces: 1, final_weight_kg: null, is_cancelled: false, product: { name: "Ayam" } }] }),
  ];
  return { data, truckId };
}

describe("drop sequence", () => {
  it("numbers drops by slot time and loads them in reverse", () => {
    const { data, truckId } = routeData();
    const q = buildLoadQueue(data, DATE, truckId)!;
    // Last drop loads first: deepest in the truck, unloaded last on the route.
    expect(q.jobs.map((j) => j.ticket.customer!.name)).toEqual(["Third", "Second", "First"]);
    expect(q.jobs.map((j) => j.dropNumber)).toEqual([3, 2, 1]);
    expect(q.jobs.every((j) => j.totalDrops === 3)).toBe(true);
  });

  it("keeps drop numbers stable when a job is already loaded", () => {
    const { data, truckId } = routeData();
    data.orders[2]!.loaded_at = "2026-08-20T00:00:00Z"; // the 08:00 drop
    const q = buildLoadQueue(data, DATE, truckId)!;
    expect(q.jobs.map((j) => j.ticket.customer!.name)).toEqual(["Second", "First", "Third"]);
    expect(q.jobs.map((j) => j.dropNumber)).toEqual([2, 1, 3]);
  });

  it("points at the next job to carry", () => {
    const { data, truckId } = routeData();
    expect(buildLoadQueue(data, DATE, truckId)!.nextJobId).toBe(data.orders[2]!.id);
    data.orders[2]!.loaded_at = "2026-08-20T00:00:00Z";
    expect(buildLoadQueue(data, DATE, truckId)!.nextJobId).toBe(data.orders[0]!.id);
  });

  it("has no next job once everything is loaded", () => {
    const { data, truckId } = routeData();
    for (const o of data.orders) o.loaded_at = "2026-08-20T00:00:00Z";
    expect(buildLoadQueue(data, DATE, truckId)!.nextJobId).toBeNull();
  });
});

describe("capacity", () => {
  it("reports loaded, planned and free kg against the truck capacity", () => {
    const { data, truckId } = routeData();
    data.trucks[0]!.capacity_kg = 100;
    data.orders[1]!.loaded_at = "2026-08-20T00:00:00Z"; // the 10 kg drop
    const q = buildLoadQueue(data, DATE, truckId)!;
    expect(q.totalKg).toBe(60);
    expect(q.loadedKg).toBe(10);
    expect(q.capacityKg).toBe(100);
    expect(q.loadedPct).toBe(10);
    expect(q.plannedPct).toBe(60);
    expect(q.freeKg).toBe(40);
    expect(q.overCapacity).toBe(false);
  });

  it("flags a truck whose planned load exceeds capacity", () => {
    const { data, truckId } = routeData();
    data.trucks[0]!.capacity_kg = 50;
    const q = buildLoadQueue(data, DATE, truckId)!;
    expect(q.overCapacity).toBe(true);
    expect(q.freeKg).toBe(0);
    expect(q.plannedPct).toBe(100); // clamped for the bar
  });

  it("leaves capacity fields null when the truck has no capacity set", () => {
    const { data, truckId } = routeData();
    const q = buildLoadQueue(data, DATE, truckId)!;
    expect(q.capacityKg).toBeNull();
    expect(q.loadedPct).toBeNull();
    expect(q.freeKg).toBeNull();
    expect(q.overCapacity).toBe(false);
  });
});

describe("buildLoadBoard", () => {
  it("returns one lane per on-board truck, with jobs already ordered", () => {
    const { data, truckId } = routeData();
    const lanes = buildLoadBoard(data, DATE);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.truck.id).toBe(truckId);
    expect(lanes[0]!.bayName).toBe("Bay A");
    expect(lanes[0]!.jobs.map((j) => j.dropNumber)).toEqual([3, 2, 1]);
    expect(lanes[0]!.totalCount).toBe(3);
  });

  it("keeps a truck with nothing assigned on the board", () => {
    const lanes = buildLoadBoard(baseData(), DATE);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.jobs).toEqual([]);
    expect(lanes[0]!.totalCount).toBe(0);
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
