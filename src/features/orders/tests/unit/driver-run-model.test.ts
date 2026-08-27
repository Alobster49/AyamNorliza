import { describe, expect, it } from "vitest";
import type { DeliveryAttempt, OrderItemWithProduct, OrderWithItems, RunStopEvent, RunWithOrders } from "../../types";
import {
  buildDriverDeck,
  dwellMinutes,
  isAtStop,
  lastAttempt,
  linesTotal,
  stopOutcome,
} from "../../lib/driver-run-model";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let counter = 0;
function uuid() {
  counter += 1;
  return `00000000-0000-4000-9000-${String(counter).padStart(12, "0")}`;
}

function makeOrder(overrides: Record<string, unknown> = {}): OrderWithItems {
  return {
    id: uuid(),
    organization_id: "org-1",
    customer_id: "cust-1",
    created_by: null,
    source: "manual",
    status: "ready",
    zone_id: "zone-1",
    delivery_address: "Jln Plumbum 7/91",
    delivery_date: "2026-08-21",
    slot_id: "slot-1",
    truck_id: "truck-1",
    run_id: "run-1",
    run_sequence: 1,
    postcode: "40000",
    assignment_source: "manual",
    notes: null,
    total_amount: 100,
    closed_at: null,
    loaded_at: "2026-08-21T01:00:00Z",
    loaded_by: "user-1",
    created_at: "",
    updated_at: "",
    version: 1,
    items: [],
    customer: { id: "cust-1", name: "Hotel Concorde", phone: "0123389021" },
    attempts: [],
    stop_events: [],
    ...overrides,
  } as OrderWithItems;
}

function makeRun(overrides: Record<string, unknown> = {}, orders: OrderWithItems[] = []): RunWithOrders {
  return {
    id: "run-1",
    organization_id: "org-1",
    truck_id: "truck-1",
    run_date: "2026-08-21",
    status: "departed",
    driver_id: "driver-1",
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
      capacity_kg: 600,
      created_by: null,
      created_at: "",
      updated_at: "",
      version: 1,
    },
    orders,
    ...overrides,
  } as RunWithOrders;
}

function event(kind: "arrive" | "leave", at: string, orderId = "o"): RunStopEvent {
  return {
    id: uuid(),
    organization_id: "org-1",
    run_id: "run-1",
    order_id: orderId,
    kind,
    at,
    recorded_by: "driver-1",
    created_at: at,
  };
}

function attempt(overrides: Partial<DeliveryAttempt> = {}): DeliveryAttempt {
  return {
    id: uuid(),
    organization_id: "org-1",
    run_id: "run-1",
    order_id: "o",
    outcome: "failed",
    reason: "shop_closed",
    next_action: "retry_today",
    note: null,
    received_by: null,
    signature_path: null,
    photo_path: null,
    cash_collected: null,
    attempted_at: "2026-08-21T05:00:00Z",
    recorded_by: "driver-1",
    created_at: "2026-08-21T05:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isAtStop / dwellMinutes
// ---------------------------------------------------------------------------

describe("isAtStop", () => {
  it("is true after an arrive with no leave behind it", () => {
    expect(isAtStop(makeOrder({ stop_events: [event("arrive", "2026-08-21T03:00:00Z")] }))).toBe(true);
  });

  it("is false once the driver has left", () => {
    const order = makeOrder({
      stop_events: [event("arrive", "2026-08-21T03:00:00Z"), event("leave", "2026-08-21T03:12:00Z")],
    });
    expect(isAtStop(order)).toBe(false);
  });

  it("is false at a stop nobody has arrived at", () => {
    expect(isAtStop(makeOrder())).toBe(false);
  });

  it("reads the events in time order, not array order", () => {
    const order = makeOrder({
      stop_events: [event("leave", "2026-08-21T03:12:00Z"), event("arrive", "2026-08-21T03:40:00Z")],
    });
    expect(isAtStop(order)).toBe(true);
  });
});

describe("dwellMinutes", () => {
  it("measures arrive to leave", () => {
    const order = makeOrder({
      stop_events: [event("arrive", "2026-08-21T03:00:00Z"), event("leave", "2026-08-21T03:31:00Z")],
    });
    expect(dwellMinutes(order)).toBe(31);
  });

  it("measures arrive to now while the driver is still there", () => {
    const order = makeOrder({ stop_events: [event("arrive", "2026-08-21T03:00:00Z")] });
    expect(dwellMinutes(order, new Date("2026-08-21T03:09:00Z"))).toBe(9);
  });

  it("is null at a stop with no arrive", () => {
    expect(dwellMinutes(makeOrder())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lastAttempt / stopOutcome
// ---------------------------------------------------------------------------

describe("lastAttempt", () => {
  it("returns the most recent attempt regardless of array order", () => {
    const order = makeOrder({
      attempts: [
        attempt({ attempted_at: "2026-08-21T05:00:00Z", reason: "shop_closed" }),
        attempt({ attempted_at: "2026-08-21T09:00:00Z", reason: "no_cash" }),
      ],
    });
    expect(lastAttempt(order)?.reason).toBe("no_cash");
  });

  it("is null when nothing has been attempted", () => {
    expect(lastAttempt(makeOrder())).toBeNull();
  });
});

describe("stopOutcome", () => {
  it("reads delivered from the order status, not just the attempt", () => {
    expect(stopOutcome(makeOrder({ status: "delivered" }))).toBe("delivered");
  });

  it("reads failed when the last attempt failed and the order is still owed", () => {
    expect(stopOutcome(makeOrder({ attempts: [attempt()] }))).toBe("failed");
  });

  it("reads pending at a stop with no attempt", () => {
    expect(stopOutcome(makeOrder())).toBe("pending");
  });

  it("prefers the delivered status over an older failed attempt", () => {
    const order = makeOrder({ status: "delivered", attempts: [attempt()] });
    expect(stopOutcome(order)).toBe("delivered");
  });
});

// ---------------------------------------------------------------------------
// buildDriverDeck
// ---------------------------------------------------------------------------

describe("buildDriverDeck", () => {
  it("puts the stop the driver is standing at first, whatever its sequence", () => {
    const a = makeOrder({ run_sequence: 1 });
    const b = makeOrder({ run_sequence: 2, stop_events: [event("arrive", "2026-08-21T04:00:00Z")] });
    const deck = buildDriverDeck(makeRun({}, [a, b]));
    expect(deck.current?.orderId).toBe(b.id);
    expect(deck.atStop).toBe(true);
  });

  it("otherwise makes the first undelivered stop current, in route order", () => {
    const a = makeOrder({ run_sequence: 1, status: "delivered" });
    const b = makeOrder({ run_sequence: 2 });
    const c = makeOrder({ run_sequence: 3 });
    const deck = buildDriverDeck(makeRun({}, [c, a, b]));
    expect(deck.current?.orderId).toBe(b.id);
    expect(deck.next?.orderId).toBe(c.id);
    expect(deck.atStop).toBe(false);
  });

  it("keeps a failed stop in the deck so it can be retried", () => {
    const a = makeOrder({ run_sequence: 1, attempts: [attempt()] });
    const deck = buildDriverDeck(makeRun({}, [a]));
    expect(deck.current?.orderId).toBe(a.id);
    expect(deck.current?.outcome).toBe("failed");
  });

  it("moves on to the next untouched stop after a failure, and comes back at the end", () => {
    const a = makeOrder({ run_sequence: 1, attempts: [attempt({ next_action: "retry_today" })] });
    const b = makeOrder({ run_sequence: 2 });
    const deck = buildDriverDeck(makeRun({}, [a, b]));
    expect(deck.current?.orderId).toBe(b.id);
    expect(deck.next?.orderId).toBe(a.id);
  });

  it("drops a stop moved to tomorrow or sent back to the yard out of today's queue", () => {
    const a = makeOrder({ run_sequence: 1, attempts: [attempt({ next_action: "move_tomorrow" })] });
    const b = makeOrder({ run_sequence: 2, attempts: [attempt({ next_action: "return_to_yard" })] });
    const deck = buildDriverDeck(makeRun({}, [a, b]));
    expect(deck.current).toBeNull();
    expect(deck.finished).toBe(true);
  });

  it("reports the run as finished when every stop has an outcome", () => {
    const a = makeOrder({ run_sequence: 1, status: "delivered" });
    const b = makeOrder({ run_sequence: 2, status: "cancelled" });
    const deck = buildDriverDeck(makeRun({}, [a, b]));
    expect(deck.current).toBeNull();
    expect(deck.finished).toBe(true);
  });

  it("counts progress and the cash the driver is carrying", () => {
    const a = makeOrder({ run_sequence: 1, status: "delivered", attempts: [attempt({ outcome: "delivered", reason: null, next_action: null, cash_collected: 486 })] });
    const b = makeOrder({ run_sequence: 2, status: "delivered", attempts: [attempt({ outcome: "delivered", reason: null, next_action: null, cash_collected: 264 })] });
    const c = makeOrder({ run_sequence: 3 });
    const deck = buildDriverDeck(makeRun({}, [a, b, c]));
    expect(deck.delivered).toBe(2);
    expect(deck.remaining).toBe(1);
    expect(deck.cashCollected).toBeCloseTo(750);
  });

  it("hands back an empty deck for a run with no stops rather than throwing", () => {
    const deck = buildDriverDeck(makeRun({}, []));
    expect(deck.current).toBeNull();
    expect(deck.stops).toEqual([]);
    expect(deck.finished).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deck items and run status
// ---------------------------------------------------------------------------

describe("deck items and run status", () => {
  it("exposes runStatus and per-stop items with price and warehouse weight", () => {
    const item: OrderItemWithProduct = {
      id: uuid(),
      order_id: "o",
      product_id: "p-1",
      mode: "kg",
      quantity: 2,
      size_min_kg: 1,
      size_max_kg: 3,
      fallback: "cancel",
      fallback_applied: null,
      is_cancelled: false,
      warehouse_weight_kg: 2.1,
      warehouse_pieces: null,
      final_weight_kg: null,
      final_pieces: null,
      price_per_kg: 12,
      line_total: null,
      created_at: "",
      updated_at: "",
      version: 1,
      product: { id: "p-1", name: "Ayam Super", image_url: null },
    };
    const order = makeOrder({ items: [item] });
    const run = makeRun({ status: "planned" }, [order]);
    const deck = buildDriverDeck(run);
    expect(deck.runStatus).toBe("planned");
    const stop = deck.stops[0];
    expect(stop).toBeDefined();
    if (!stop) return;
    expect(stop.items).toEqual([
      {
        itemId: item.id,
        productName: "Ayam Super",
        mode: "kg",
        quantity: 2,
        warehouseWeightKg: 2.1,
        pricePerKg: 12,
      },
    ]);
  });

  it("excludes cancelled items", () => {
    const liveItem: OrderItemWithProduct = {
      id: uuid(),
      order_id: "o",
      product_id: "p-1",
      mode: "kg",
      quantity: 2,
      size_min_kg: 1,
      size_max_kg: 3,
      fallback: "cancel",
      fallback_applied: null,
      is_cancelled: false,
      warehouse_weight_kg: 2.1,
      warehouse_pieces: null,
      final_weight_kg: null,
      final_pieces: null,
      price_per_kg: 12,
      line_total: null,
      created_at: "",
      updated_at: "",
      version: 1,
      product: { id: "p-1", name: "Ayam Super", image_url: null },
    };
    const cancelledItem: OrderItemWithProduct = {
      id: uuid(),
      order_id: "o",
      product_id: "p-2",
      mode: "piece",
      quantity: 1,
      size_min_kg: 1,
      size_max_kg: 3,
      fallback: "cancel",
      fallback_applied: null,
      is_cancelled: true,
      warehouse_weight_kg: null,
      warehouse_pieces: null,
      final_weight_kg: null,
      final_pieces: null,
      price_per_kg: null,
      line_total: null,
      created_at: "",
      updated_at: "",
      version: 1,
      product: { id: "p-2", name: "Cancelled Product", image_url: null },
    };
    const order = makeOrder({ items: [liveItem, cancelledItem] });
    const run = makeRun({}, [order]);
    const deck = buildDriverDeck(run);
    const stop = deck.stops[0];
    expect(stop).toBeDefined();
    if (!stop) return;
    expect(stop.items).toHaveLength(1);
    const firstItem = stop.items[0];
    expect(firstItem).toBeDefined();
    if (!firstItem) return;
    expect(firstItem.itemId).toBe(liveItem.id);
  });
});

// ---------------------------------------------------------------------------
// linesTotal
// ---------------------------------------------------------------------------

describe("linesTotal", () => {
  it("sums weight × price and rounds to 2 dp", () => {
    expect(
      linesTotal([
        { weightKg: 2.335, pricePerKg: 12 },
        { weightKg: 1, pricePerKg: 10.5 },
      ]),
    ).toBe(38.52);
  });

  it("skips entries missing weight or price", () => {
    expect(
      linesTotal([
        { weightKg: null, pricePerKg: 12 },
        { weightKg: 2, pricePerKg: null },
        { weightKg: 3, pricePerKg: 10 },
      ]),
    ).toBe(30);
  });
});
