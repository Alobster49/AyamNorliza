import { describe, expect, it } from "vitest";
import type { DispatchBoardData, DispatchTicket } from "../../types";
import { draftPlan, orderWeightKg, totalWeightKg } from "../../lib/plan-model";

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

  it("plans orders the board pools as a safety net (assigned to an off-board truck)", () => {
    const data = baseData();
    // Truck 2 has no bay, so the board refuses to show tickets on it and
    // pools them instead — the plan must offer those a real truck too.
    const offBoard = truck({ id: "truck-off".padEnd(36, "0"), code: "T2", bay_id: null });
    data.trucks = [...data.trucks, offBoard];
    data.orders = [order({ assignment_source: "manual", truck_id: offBoard.id })];

    const draft = draftPlan(data, DATE);
    expect(draft.poolCount).toBe(1);
    expect(draft.proposals.length + draft.exceptions.length).toBe(1);
    expect(draft.proposals[0]!.truckId).toBe(data.trucks[0]!.id);
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
