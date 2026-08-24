import { describe, expect, it } from "vitest";
import type { OrderWithItems, RunWithOrders } from "../../types";
import {
  boardAlerts,
  moveStop,
  departureCheck,
  departureImpact,
  completionImpact,
  runStopRows,
  runVitals,
  stopState,
  truckLabel,
} from "../../lib/run-board-model";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let counter = 0;
function uuid() {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    order_id: "order-1",
    product_id: "prod-1",
    mode: "kg",
    quantity: 10,
    size_min_kg: 1.5,
    size_max_kg: 1.7,
    fallback: "cancel",
    fallback_applied: null,
    is_cancelled: false,
    warehouse_weight_kg: null,
    final_weight_kg: null,
    warehouse_pieces: null,
    final_pieces: null,
    price_per_kg: 12,
    line_total: null,
    created_at: "2026-08-21T00:00:00Z",
    updated_at: "2026-08-21T00:00:00Z",
    version: 1,
    ...overrides,
  } as OrderWithItems["items"][number];
}

function makeOrder(overrides: Record<string, unknown> = {}): OrderWithItems {
  return {
    id: uuid(),
    organization_id: "org-1",
    customer_id: "cust-1",
    created_by: null,
    source: "portal",
    status: "ready",
    zone_id: "zone-1",
    delivery_address: "Jln Plumbum 7/91, Sek 7",
    delivery_date: "2026-08-21",
    slot_id: "slot-1",
    truck_id: "truck-1",
    run_id: "run-1",
    run_sequence: null,
    postcode: "40000",
    assignment_source: "auto",
    notes: null,
    total_amount: 100,
    closed_at: null,
    loaded_at: "2026-08-21T01:00:00Z",
    loaded_by: "user-1",
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    version: 1,
    items: [makeItem({ final_weight_kg: 20 })],
    attempts: [],
    customer: { id: "cust-1", name: "Restoran Deen", phone: "0123389021" },
    zone: {
      id: "zone-1",
      organization_id: "org-1",
      name: "Shah Alam",
      display_order: 1,
      is_active: true,
      created_by: null,
      created_at: "",
      updated_at: "",
      version: 1,
    },
    slot: {
      id: "slot-1",
      organization_id: "org-1",
      truck_id: "truck-1",
      weekday: 4,
      start_time: "09:00:00",
      end_time: "10:00:00",
      max_orders: null,
      is_active: true,
      created_by: null,
      created_at: "",
      updated_at: "",
      version: 1,
    },
    ...overrides,
  } as OrderWithItems;
}

function makeRun(overrides: Record<string, unknown> = {}, orders: OrderWithItems[] = []): RunWithOrders {
  return {
    id: "run-1",
    organization_id: "org-1",
    truck_id: "truck-1",
    run_date: "2026-08-21",
    status: "planned",
    notes: null,
    created_at: "",
    updated_at: "",
    version: 1,
    truck: {
      id: "truck-1",
      organization_id: "org-1",
      name: "Lori 1",
      code: "TRK-01",
      is_active: true,
      bay_id: null,
      capacity_kg: 100,
      created_by: null,
      created_at: "",
      updated_at: "",
      version: 1,
    },
    orders,
    ...overrides,
  } as RunWithOrders;
}

// ---------------------------------------------------------------------------
// runVitals
// ---------------------------------------------------------------------------

describe("runVitals", () => {
  it("counts stops by delivery state and ignores cancelled orders in the total", () => {
    const run = makeRun({}, [
      makeOrder({ status: "delivered" }),
      makeOrder({ status: "closed" }),
      makeOrder({ status: "ready" }),
      makeOrder({ status: "cancelled" }),
    ]);
    const v = runVitals(run);
    expect(v.total).toBe(3);
    expect(v.delivered).toBe(2);
    expect(v.remaining).toBe(1);
    expect(v.failed).toBe(1);
    expect(v.progressPct).toBeCloseTo((2 / 3) * 100);
  });

  it("returns zero progress for an empty run rather than NaN", () => {
    const v = runVitals(makeRun({}, []));
    expect(v.total).toBe(0);
    expect(v.progressPct).toBe(0);
    expect(v.loadPct).toBe(0);
  });

  it("sums recorded weights, preferring final over warehouse, skipping cancelled lines", () => {
    const run = makeRun({}, [
      makeOrder({
        items: [
          makeItem({ final_weight_kg: 12.5, warehouse_weight_kg: 11 }),
          makeItem({ final_weight_kg: null, warehouse_weight_kg: 7.5 }),
          makeItem({ final_weight_kg: 99, is_cancelled: true }),
        ],
      }),
    ]);
    expect(runVitals(run).weightKg).toBeCloseTo(20);
  });

  it("reports load percentage against truck capacity and flags an overload", () => {
    const run = makeRun({}, [makeOrder({ items: [makeItem({ final_weight_kg: 120 })] })]);
    const v = runVitals(run);
    expect(v.capacityKg).toBe(100);
    expect(v.loadPct).toBeCloseTo(120);
    expect(v.overloaded).toBe(true);
  });

  it("leaves load percentage null when the truck has no capacity recorded", () => {
    const run = makeRun({ truck: { ...makeRun().truck, capacity_kg: null } }, [makeOrder()]);
    const v = runVitals(run);
    expect(v.loadPct).toBeNull();
    expect(v.overloaded).toBe(false);
  });

  it("counts the cash the driver actually recorded at the door when there is an attempt", () => {
    const order = makeOrder({ status: "delivered", total_amount: 486 });
    const run = makeRun({}, [
      {
        ...order,
        attempts: [
          {
            ...failedAttempt(order.id),
            outcome: "delivered" as const,
            reason: null,
            next_action: null,
            cash_collected: 400,
          },
        ],
      },
    ]);
    // The customer paid 400 of a 486 invoice: the office needs the 400 the
    // driver is carrying, not the number on the paperwork.
    expect(runVitals(run).cashCollected).toBeCloseTo(400);
  });

  it("falls back to the order total for a stop the office closed with no attempt", () => {
    const run = makeRun({}, [makeOrder({ status: "delivered", total_amount: 486 })]);
    expect(runVitals(run).cashCollected).toBeCloseTo(486);
  });

  it("splits cash into collected and outstanding by delivery state", () => {
    const run = makeRun({}, [
      makeOrder({ status: "delivered", total_amount: 486 }),
      makeOrder({ status: "closed", total_amount: 264 }),
      makeOrder({ status: "ready", total_amount: 218.4 }),
      makeOrder({ status: "cancelled", total_amount: 999 }),
    ]);
    const v = runVitals(run);
    expect(v.cashCollected).toBeCloseTo(750);
    expect(v.cashOutstanding).toBeCloseTo(218.4);
  });

  it("derives the run window from the earliest and latest slot on it", () => {
    const run = makeRun({}, [
      makeOrder({ slot: { ...makeOrder().slot, start_time: "11:00:00", end_time: "12:00:00" } }),
      makeOrder({ slot: { ...makeOrder().slot, start_time: "08:00:00", end_time: "09:00:00" } }),
    ]);
    expect(runVitals(run).window).toEqual({ start: "08:00", end: "12:00" });
  });

  it("counts loaded orders separately from delivered ones", () => {
    const run = makeRun({}, [
      makeOrder({ loaded_at: "2026-08-21T01:00:00Z" }),
      makeOrder({ loaded_at: null }),
      makeOrder({ loaded_at: null, status: "cancelled" }),
    ]);
    const v = runVitals(run);
    expect(v.loaded).toBe(1);
    expect(v.unloaded).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// departureCheck
// ---------------------------------------------------------------------------

describe("departureCheck", () => {
  it("blocks departure while an order is still unloaded and names it", () => {
    const run = makeRun({}, [
      makeOrder({ loaded_at: "2026-08-21T01:00:00Z" }),
      makeOrder({ loaded_at: null, customer: { id: "c2", name: "Warung Cik Ros", phone: "0111" } }),
    ]);
    const check = departureCheck(run);
    expect(check.canDepart).toBe(false);
    expect(check.unloaded.map((o) => o.label)).toEqual(["Warung Cik Ros"]);
  });

  it("blocks departure while a line is still unweighed", () => {
    const run = makeRun({}, [
      makeOrder({ items: [makeItem({ final_weight_kg: null, warehouse_weight_kg: null })] }),
    ]);
    const check = departureCheck(run);
    expect(check.canDepart).toBe(false);
    expect(check.unweighed).toHaveLength(1);
  });

  it("allows departure when every non-cancelled order is loaded and weighed", () => {
    const run = makeRun({}, [makeOrder(), makeOrder()]);
    expect(departureCheck(run).canDepart).toBe(true);
  });

  it("ignores cancelled orders when gating departure", () => {
    const run = makeRun({}, [makeOrder(), makeOrder({ status: "cancelled", loaded_at: null })]);
    expect(departureCheck(run).canDepart).toBe(true);
  });

  it("never blocks a run that has already departed", () => {
    const run = makeRun({ status: "departed" }, [makeOrder({ loaded_at: null })]);
    expect(departureCheck(run).canDepart).toBe(true);
  });
});

describe("departureImpact", () => {
  it("lists the orders the depart RPC will strip off the run because they are not ready", () => {
    const run = makeRun({}, [
      makeOrder({ status: "ready" }),
      makeOrder({ status: "confirmed", customer: { id: "c2", name: "Warung Cik Ros", phone: "" } }),
      makeOrder({ status: "pending", customer: { id: "c3", name: "Kedai Pak Mat", phone: "" } }),
    ]);
    expect(departureImpact(run).droppedFromRun.map((o) => o.label)).toEqual([
      "Warung Cik Ros",
      "Kedai Pak Mat",
    ]);
  });

  it("is empty when every order on the run is ready", () => {
    expect(departureImpact(makeRun({}, [makeOrder({ status: "ready" })])).droppedFromRun).toEqual([]);
  });
});

describe("completionImpact", () => {
  it("counts the ready orders that completing the run will mark delivered", () => {
    const run = makeRun({ status: "departed" }, [
      makeOrder({ status: "ready" }),
      makeOrder({ status: "ready" }),
      makeOrder({ status: "delivered" }),
    ]);
    expect(completionImpact(run).markedDelivered).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runStopRows / stopState
// ---------------------------------------------------------------------------

describe("runStopRows", () => {
  it("orders stops by slot start, then zone, then customer name", () => {
    const late = makeOrder({
      slot: { ...makeOrder().slot, start_time: "14:00:00" },
      customer: { id: "c1", name: "Zulkifli", phone: "" },
    });
    const earlyB = makeOrder({
      slot: { ...makeOrder().slot, start_time: "09:00:00" },
      customer: { id: "c2", name: "Bakar", phone: "" },
    });
    const earlyA = makeOrder({
      slot: { ...makeOrder().slot, start_time: "09:00:00" },
      customer: { id: "c3", name: "Ahmad", phone: "" },
    });
    const rows = runStopRows(makeRun({}, [late, earlyB, earlyA]));
    expect(rows.map((r) => r.customerName)).toEqual(["Ahmad", "Bakar", "Zulkifli"]);
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("follows run_sequence when the dispatcher has set a route order", () => {
    const a = makeOrder({ run_sequence: 3, customer: { id: "c1", name: "Ahmad", phone: "" } });
    const b = makeOrder({ run_sequence: 1, customer: { id: "c2", name: "Bakar", phone: "" } });
    const c = makeOrder({ run_sequence: 2, customer: { id: "c3", name: "Chong", phone: "" } });
    const rows = runStopRows(makeRun({}, [a, b, c]));
    expect(rows.map((r) => r.customerName)).toEqual(["Bakar", "Chong", "Ahmad"]);
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("puts orders with no sequence after the sequenced ones", () => {
    const sequenced = makeOrder({ run_sequence: 2, customer: { id: "c1", name: "Ahmad", phone: "" } });
    const loose = makeOrder({ run_sequence: null, customer: { id: "c2", name: "Bakar", phone: "" } });
    const rows = runStopRows(makeRun({}, [loose, sequenced]));
    expect(rows.map((r) => r.customerName)).toEqual(["Ahmad", "Bakar"]);
  });

  it("summarises weight and item count per stop", () => {
    const run = makeRun({}, [
      makeOrder({
        items: [makeItem({ final_weight_kg: 18.5 }), makeItem({ final_weight_kg: 20 }), makeItem({ is_cancelled: true })],
      }),
    ]);
    const row = runStopRows(run)[0]!;
    expect(row.itemCount).toBe(2);
    expect(row.weightKg).toBeCloseTo(38.5);
  });

  it("falls back to a placeholder when the customer join is missing", () => {
    const row = runStopRows(makeRun({}, [makeOrder({ customer: undefined })]))[0]!;
    expect(row.customerName).toBe("Unknown customer");
  });
});

function failedAttempt(orderId: string) {
  return {
    id: uuid(),
    organization_id: "org-1",
    run_id: "run-1",
    order_id: orderId,
    outcome: "failed" as const,
    reason: "shop_closed" as const,
    next_action: "retry_today" as const,
    note: null,
    received_by: null,
    signature_path: null,
    photo_path: null,
    cash_collected: null,
    attempted_at: "2026-08-21T05:00:00Z",
    recorded_by: "driver-1",
    created_at: "2026-08-21T05:00:00Z",
  };
}

describe("stopState", () => {
  it("reads dropped for a delivered or closed order", () => {
    expect(stopState(makeOrder({ status: "delivered" }), "departed").kind).toBe("dropped");
    expect(stopState(makeOrder({ status: "closed" }), "completed").kind).toBe("dropped");
  });

  it("reads failed for a cancelled order", () => {
    expect(stopState(makeOrder({ status: "cancelled" }), "departed").kind).toBe("failed");
  });

  it("reads failed when the driver reported the stop could not be delivered", () => {
    const order = makeOrder({ status: "ready" });
    const state = stopState({ ...order, attempts: [failedAttempt(order.id)] }, "departed");
    expect(state.kind).toBe("failed");
    expect(state.labelKey).toBe("status.delivery.failureReason.shopClosed");
  });

  it("still reads dropped when a later delivery followed a failed attempt", () => {
    const order = makeOrder({ status: "delivered" });
    expect(stopState({ ...order, attempts: [failedAttempt(order.id)] }, "departed").kind).toBe("dropped");
  });

  it("reads not loaded while the run is still planned and the order has no loaded_at", () => {
    expect(stopState(makeOrder({ loaded_at: null }), "planned").kind).toBe("not_loaded");
  });

  it("reads on the truck once the run has departed", () => {
    expect(stopState(makeOrder({ status: "ready" }), "departed").kind).toBe("on_truck");
  });

  it("reads waiting for a loaded order on a run that has not left yet", () => {
    expect(stopState(makeOrder({ status: "ready" }), "planned").kind).toBe("waiting");
  });
});

// ---------------------------------------------------------------------------
// boardAlerts — the "needs a human" block
// ---------------------------------------------------------------------------

describe("boardAlerts", () => {
  it("raises an alert for a planned run holding unloaded orders", () => {
    const run = makeRun({}, [makeOrder({ loaded_at: null })]);
    const alerts = boardAlerts([run]);
    expect(alerts.map((a) => a.kind)).toContain("unloaded");
    expect(alerts[0]!.truckLabel).toBe("Lori 1 (TRK-01)");
  });

  it("raises an alert for an overloaded truck", () => {
    const run = makeRun({}, [makeOrder({ items: [makeItem({ final_weight_kg: 140 })] })]);
    expect(boardAlerts([run]).map((a) => a.kind)).toContain("overloaded");
  });

  it("raises an alert for a failed stop on a departed run", () => {
    const run = makeRun({ status: "departed" }, [makeOrder(), makeOrder({ status: "cancelled" })]);
    expect(boardAlerts([run]).map((a) => a.kind)).toContain("failed");
  });

  it("raises an alert for a stop the driver reported as undeliverable", () => {
    const order = makeOrder({ status: "ready" });
    const run = makeRun({ status: "departed" }, [{ ...order, attempts: [failedAttempt(order.id)] }]);
    const alert = boardAlerts([run]).find((a) => a.kind === "failed");
    expect(alert?.message).toContain("1 stop");
  });

  it("raises an alert when a departed run still has undelivered stops after its window closed", () => {
    const run = makeRun({ status: "departed" }, [makeOrder({ status: "ready" })]);
    const alerts = boardAlerts([run], { nowMinutes: 11 * 60 });
    expect(alerts.map((a) => a.kind)).toContain("overdue");
  });

  it("stays quiet when nothing needs a human", () => {
    const run = makeRun({ status: "completed" }, [makeOrder({ status: "delivered" })]);
    expect(boardAlerts([run], { nowMinutes: 9 * 60 })).toEqual([]);
  });

  it("does not raise unloaded twice for the same run", () => {
    const run = makeRun({}, [makeOrder({ loaded_at: null }), makeOrder({ loaded_at: null })]);
    const unloaded = boardAlerts([run]).filter((a) => a.kind === "unloaded");
    expect(unloaded).toHaveLength(1);
    expect(unloaded[0]!.message).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

describe("moveStop", () => {
  it("moves a stop down the route", () => {
    expect(moveStop(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves a stop up the route", () => {
    expect(moveStop(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("clamps a target past either end instead of dropping the stop", () => {
    expect(moveStop(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
    expect(moveStop(["a", "b", "c"], 2, -4)).toEqual(["c", "a", "b"]);
  });

  it("returns the same order when the stop does not move", () => {
    expect(moveStop(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("leaves the list alone when the source index is out of range", () => {
    expect(moveStop(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("truckLabel", () => {
  it("joins name and code, and falls back when the truck join is missing", () => {
    expect(truckLabel(makeRun())).toBe("Lori 1 (TRK-01)");
    expect(truckLabel(makeRun({ truck: undefined }))).toBe("Unassigned truck");
  });
});
