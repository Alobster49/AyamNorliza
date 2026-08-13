import { describe, expect, it } from "vitest";
import { suggestTruck, weekdayOf, type AssignmentContext } from "../../lib/assignment";
import type { DispatchTruck, ZonePostcodeRange } from "../../types";
import type {
  DeliverySlot,
  DeliveryZone,
  ScheduleBlock,
  TruckZone,
} from "@/features/orders/types";

function zone(id: string, name: string): DeliveryZone {
  return {
    id, organization_id: "org-1", name, display_order: 0, is_active: true,
    created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function range(zoneId: string, start: string, end: string): ZonePostcodeRange {
  return {
    id: `${zoneId}-${start}`, organization_id: "org-1", zone_id: zoneId,
    postcode_start: start, postcode_end: end, created_by: null, created_at: "",
  };
}
function truck(id: string, code: string, bayId: string | null, active = true): DispatchTruck {
  return {
    id, organization_id: "org-1", name: `Truck ${code}`, code, is_active: active,
    bay_id: bayId, created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function slot(truckId: string, weekday: number, start: string, maxOrders: number | null): DeliverySlot {
  return {
    id: `slot-${truckId}-${weekday}-${start}`, organization_id: "org-1", truck_id: truckId,
    weekday, start_time: start, end_time: "23:00", max_orders: maxOrders, is_active: true,
    created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function block(truckId: string | null, date: string): ScheduleBlock {
  return {
    id: `block-${truckId ?? "all"}-${date}`, organization_id: "org-1",
    block_date: date, truck_id: truckId, reason: null, created_by: null, created_at: "",
  };
}

// 2026-08-14 is a Friday -> weekday 5.
const DATE = "2026-08-14";
const WD = 5;

function ctx(overrides: Partial<AssignmentContext> = {}): AssignmentContext {
  const truckZones: TruckZone[] = [
    { truck_id: "t-1", zone_id: "z-south", organization_id: "org-1" },
    { truck_id: "t-2", zone_id: "z-south", organization_id: "org-1" },
  ];
  return {
    zones: [zone("z-south", "South")],
    ranges: [range("z-south", "82000", "82300")],
    truckZones,
    trucks: [truck("t-1", "T1", "bay-1"), truck("t-2", "T2", "bay-1")],
    slots: [slot("t-1", WD, "09:00", 5), slot("t-2", WD, "09:00", 5)],
    blocks: [],
    loads: {},
    ...overrides,
  };
}

const ORDER = { postcode: "82100", delivery_date: DATE, slot_start_time: "09:00" };

describe("weekdayOf", () => {
  it("computes weekday without timezone drift", () => {
    expect(weekdayOf("2026-08-14")).toBe(5); // Friday
    expect(weekdayOf("2026-08-16")).toBe(0); // Sunday
  });
});

describe("suggestTruck", () => {
  it("fails without a postcode", () => {
    const result = suggestTruck({ ...ORDER, postcode: null }, ctx());
    expect(result).toEqual({ ok: false, reason: "no_postcode" });
  });

  it("fails when no zone covers the postcode", () => {
    const result = suggestTruck({ ...ORDER, postcode: "50000" }, ctx());
    expect(result).toEqual({ ok: false, reason: "no_zone_match" });
  });

  it("picks the least-loaded covering truck", () => {
    const result = suggestTruck(ORDER, ctx({ loads: { "t-1": 3, "t-2": 1 } }));
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("breaks load ties by lowest truck code", () => {
    const result = suggestTruck(ORDER, ctx({ loads: { "t-1": 2, "t-2": 2 } }));
    expect(result).toEqual({ ok: true, truckId: "t-1", zoneId: "z-south" });
  });

  it("skips inactive trucks", () => {
    const result = suggestTruck(
      ORDER,
      ctx({ trucks: [truck("t-1", "T1", "bay-1", false), truck("t-2", "T2", "bay-1")] }),
    );
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("skips trucks without a bay", () => {
    const result = suggestTruck(
      ORDER,
      ctx({ trucks: [truck("t-1", "T1", null), truck("t-2", "T2", "bay-1")] }),
    );
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("skips trucks blocked on the delivery date, and treats a null-truck block as blocking all", () => {
    const perTruck = suggestTruck(ORDER, ctx({ blocks: [block("t-1", DATE)] }));
    expect(perTruck).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });

    const allBlocked = suggestTruck(ORDER, ctx({ blocks: [block(null, DATE)] }));
    expect(allBlocked).toEqual({ ok: false, reason: "no_covering_truck" });
  });

  it("skips trucks with no matching active slot for the order's weekday and start time", () => {
    const result = suggestTruck(ORDER, ctx({ slots: [slot("t-2", WD, "09:00", 5)] }));
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("skips trucks at their slot max_orders cap; null cap means unlimited", () => {
    const capped = suggestTruck(
      ORDER,
      ctx({ slots: [slot("t-1", WD, "09:00", 2), slot("t-2", WD, "09:00", 2)], loads: { "t-1": 2, "t-2": 1 } }),
    );
    expect(capped).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });

    const allFull = suggestTruck(
      ORDER,
      ctx({ slots: [slot("t-1", WD, "09:00", 1), slot("t-2", WD, "09:00", 1)], loads: { "t-1": 1, "t-2": 1 } }),
    );
    expect(allFull).toEqual({ ok: false, reason: "all_trucks_full" });

    const unlimited = suggestTruck(
      ORDER,
      ctx({ slots: [slot("t-1", WD, "09:00", null)], trucks: [truck("t-1", "T1", "bay-1")], loads: { "t-1": 99 } }),
    );
    expect(unlimited).toEqual({ ok: true, truckId: "t-1", zoneId: "z-south" });
  });
});
