import { describe, expect, it } from "vitest";
import { buildBoardView, compatibleTruckIds } from "../../lib/dispatch-board-model";
import type { Bay, DispatchBoardData, DispatchTicket, DispatchTruck } from "../../types";

const DATE = "2026-08-14"; // Friday, weekday 5

function bay(id: string, name: string, position: number, active = true): Bay {
  return {
    id, organization_id: "org-1", facility_id: "fac-1", name, position,
    is_active: active, created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function truck(id: string, code: string, bayId: string | null, active = true): DispatchTruck {
  return {
    id, organization_id: "org-1", name: `Truck ${code}`, code, is_active: active,
    bay_id: bayId, created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function ticket(id: string, truckId: string, source: "none" | "auto" | "manual", status: "confirmed" | "ready" = "confirmed"): DispatchTicket {
  return {
    id, organization_id: "org-1", customer_id: "cust-1", created_by: null,
    source: "portal", status, zone_id: "z-south", delivery_address: "addr",
    delivery_date: DATE, slot_id: "slot-1", truck_id: truckId, run_id: null,
    notes: null, total_amount: 0, closed_at: null, created_at: "", updated_at: "",
    version: 1, postcode: "82100", assignment_source: source,
    customer: { name: `Customer ${id}` },
  };
}

function data(overrides: Partial<DispatchBoardData> = {}): DispatchBoardData {
  return {
    facility: null,
    bays: [bay("bay-2", "Bay 2", 2), bay("bay-1", "Bay 1", 1)],
    trucks: [truck("t-1", "T1", "bay-1"), truck("t-2", "T2", "bay-2")],
    zones: [{
      id: "z-south", organization_id: "org-1", name: "South", display_order: 0,
      is_active: true, created_by: null, created_at: "", updated_at: "", version: 1,
    }],
    ranges: [{
      id: "r-1", organization_id: "org-1", zone_id: "z-south",
      postcode_start: "82000", postcode_end: "82300", created_by: null, created_at: "",
    }],
    truckZones: [{ truck_id: "t-1", zone_id: "z-south", organization_id: "org-1" }],
    slots: [{
      id: "slot-1", organization_id: "org-1", truck_id: "t-1", weekday: 5,
      start_time: "09:00:00", end_time: "12:00:00", max_orders: 5, is_active: true,
      created_by: null, created_at: "", updated_at: "", version: 1,
    }],
    blocks: [],
    runs: [],
    orders: [],
    ...overrides,
  };
}

describe("buildBoardView", () => {
  it("orders bays by position", () => {
    const view = buildBoardView(data(), DATE);
    expect(view.bays.map((b) => b.bay.id)).toEqual(["bay-1", "bay-2"]);
  });

  it("puts source='none' tickets in the pool and assigned tickets on their truck", () => {
    const view = buildBoardView(
      data({ orders: [ticket("o-1", "t-1", "none"), ticket("o-2", "t-1", "auto")] }),
      DATE,
    );
    expect(view.pool.map((t) => t.id)).toEqual(["o-1"]);
    const t1 = view.bays[0]!.trucks.find((t) => t.truck.id === "t-1")!;
    expect(t1.tickets.map((t) => t.id)).toEqual(["o-2"]);
    expect(t1.load).toBe(1);
    expect(t1.cap).toBe(5);
  });

  it("sends tickets on an inactive truck back to the pool", () => {
    const view = buildBoardView(
      data({
        trucks: [truck("t-1", "T1", "bay-1", false), truck("t-2", "T2", "bay-2")],
        orders: [ticket("o-1", "t-1", "manual")],
      }),
      DATE,
    );
    expect(view.pool.map((t) => t.id)).toEqual(["o-1"]);
  });

  it("marks a truck departed when its run for the date is departed", () => {
    const view = buildBoardView(
      data({
        runs: [{
          id: "run-1", organization_id: "org-1", truck_id: "t-1", run_date: DATE,
          status: "departed", notes: null, created_at: "", updated_at: "", version: 1,
        }],
      }),
      DATE,
    );
    const t1 = view.bays[0]!.trucks.find((t) => t.truck.id === "t-1")!;
    expect(t1.departed).toBe(true);
    expect(t1.run?.id).toBe("run-1");
  });

  it("sends a manually-assigned ticket back to the pool when the truck's bay is inactive", () => {
    const view = buildBoardView(
      data({
        bays: [bay("bay-2", "Bay 2", 2), bay("bay-1", "Bay 1", 1, false)],
        orders: [ticket("o-1", "t-1", "manual")],
      }),
      DATE,
    );
    expect(view.pool.map((t) => t.id)).toEqual(["o-1"]);
  });

  it("orders a truck's tickets by slot start time, not customer name", () => {
    const view = buildBoardView(
      data({
        slots: [
          {
            id: "slot-1", organization_id: "org-1", truck_id: "t-1", weekday: 5,
            start_time: "09:00:00", end_time: "12:00:00", max_orders: 5, is_active: true,
            created_by: null, created_at: "", updated_at: "", version: 1,
          },
          {
            id: "slot-2", organization_id: "org-1", truck_id: "t-1", weekday: 5,
            start_time: "07:00:00", end_time: "09:00:00", max_orders: 5, is_active: true,
            created_by: null, created_at: "", updated_at: "", version: 1,
          },
        ],
        orders: [
          { ...ticket("o-a", "t-1", "manual"), slot_id: "slot-1", customer: { name: "Alpha" } },
          { ...ticket("o-z", "t-1", "manual"), slot_id: "slot-2", customer: { name: "Zulu" } },
        ],
      }),
      DATE,
    );
    const t1 = view.bays[0]!.trucks.find((t) => t.truck.id === "t-1")!;
    expect(t1.tickets.map((t) => t.id)).toEqual(["o-z", "o-a"]);
  });
});

describe("compatibleTruckIds", () => {
  it("returns trucks covering the ticket's matched zone", () => {
    const ids = compatibleTruckIds(ticket("o-1", "t-1", "none"), data());
    expect(ids).toEqual(new Set(["t-1"]));
  });

  it("returns an empty set when the postcode matches no zone", () => {
    const t = { ...ticket("o-1", "t-1", "none"), postcode: "50000" };
    expect(compatibleTruckIds(t, data())).toEqual(new Set());
  });
});
