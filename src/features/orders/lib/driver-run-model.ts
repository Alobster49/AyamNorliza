/**
 * Pure model behind the driver deck — the phone screen that shows one stop at
 * a time and records what happened at the door.
 *
 * The deck's central decision is "which stop is the driver on right now". It
 * is not simply the first undelivered stop: a driver standing at stop 8 with
 * stop 5 still unresolved is at stop 8, and the screen has to say so. An
 * unclosed arrive event is therefore what makes a stop current; route order
 * only decides what comes next.
 *
 * No React, no I/O — unit tested in tests/unit/driver-run-model.test.ts.
 */

import type { DeliveryAttempt, OrderWithItems, RunWithOrders } from "../types";
import { customerName, liveItemCount, orderWeightKg, sortedRunOrders } from "./run-board-model";

export type StopOutcome = "delivered" | "failed" | "cancelled" | "pending";

// ---------------------------------------------------------------------------
// Per-stop reads
// ---------------------------------------------------------------------------

function eventsInOrder(order: OrderWithItems) {
  return (order.stop_events ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
}

/** True when the last mark at this stop was an arrive with no leave after it. */
export function isAtStop(order: OrderWithItems): boolean {
  return eventsInOrder(order).at(-1)?.kind === "arrive";
}

/**
 * Minutes between arriving and leaving, or between arriving and now while the
 * driver is still there. Null at a stop nobody has arrived at.
 */
export function dwellMinutes(order: OrderWithItems, now: Date = new Date()): number | null {
  const events = eventsInOrder(order);
  const lastArrive = events.filter((e) => e.kind === "arrive").at(-1);
  if (!lastArrive) return null;
  const leave = events.filter((e) => e.kind === "leave" && e.at > lastArrive.at).at(0);
  const end = leave ? new Date(leave.at) : now;
  return Math.round((end.getTime() - new Date(lastArrive.at).getTime()) / 60000);
}

export function lastAttempt(order: OrderWithItems): DeliveryAttempt | null {
  const attempts = (order.attempts ?? []).slice().sort((a, b) => a.attempted_at.localeCompare(b.attempted_at));
  return attempts.at(-1) ?? null;
}

/**
 * What has happened at this stop. The order's own status wins over the attempt
 * log: a stop the office marked delivered when closing the run has no attempt
 * row at all, and a delivered order should never read as failed because of an
 * earlier knock at a locked gate.
 */
export function stopOutcome(order: OrderWithItems): StopOutcome {
  if (order.status === "delivered" || order.status === "closed") return "delivered";
  if (order.status === "cancelled") return "cancelled";
  return lastAttempt(order)?.outcome === "failed" ? "failed" : "pending";
}

/** A stop is done for today once it is delivered or written off. */
function isResolved(order: OrderWithItems): boolean {
  const outcome = stopOutcome(order);
  return outcome === "delivered" || outcome === "cancelled";
}

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

export type DriverStop = {
  orderId: string;
  sequence: number;
  customerName: string;
  phone: string | null;
  address: string;
  zoneName: string;
  notes: string | null;
  itemCount: number;
  weightKg: number;
  amount: number;
  window: { start: string; end: string } | null;
  outcome: StopOutcome;
  atStop: boolean;
  dwellMinutes: number | null;
  lastFailureReason: DeliveryAttempt["reason"];
};

export type DriverDeck = {
  runId: string;
  truckLabel: string;
  stops: DriverStop[];
  /** The stop the driver is standing at, or the next one to drive to. */
  current: DriverStop | null;
  next: DriverStop | null;
  atStop: boolean;
  delivered: number;
  failed: number;
  remaining: number;
  total: number;
  progressPct: number;
  cashCollected: number;
  finished: boolean;
};

export function buildDriverDeck(run: RunWithOrders, now: Date = new Date()): DriverDeck {
  const stops: DriverStop[] = sortedRunOrders(run).map((order, index) => ({
    orderId: order.id,
    sequence: index + 1,
    customerName: customerName(order),
    phone: order.customer?.phone ?? null,
    address: order.delivery_address,
    zoneName: order.zone?.name ?? "-",
    notes: order.notes,
    itemCount: liveItemCount(order),
    weightKg: Math.round(orderWeightKg(order) * 100) / 100,
    amount: order.total_amount ?? 0,
    window: order.slot
      ? { start: order.slot.start_time.slice(0, 5), end: order.slot.end_time.slice(0, 5) }
      : null,
    outcome: stopOutcome(order),
    atStop: isAtStop(order),
    dwellMinutes: dwellMinutes(order, now),
    lastFailureReason: lastAttempt(order)?.reason ?? null,
  }));

  // Standing at a stop beats route order: that is where the driver actually is.
  const current =
    stops.find((stop) => stop.atStop && stop.outcome !== "delivered" && stop.outcome !== "cancelled") ??
    stops.find((stop) => stop.outcome === "pending" || stop.outcome === "failed") ??
    null;

  const next = current
    ? (stops
        .slice(stops.indexOf(current) + 1)
        .find((stop) => stop.outcome === "pending" || stop.outcome === "failed") ?? null)
    : null;

  const delivered = stops.filter((stop) => stop.outcome === "delivered").length;
  const failed = stops.filter((stop) => stop.outcome === "failed").length;
  const live = stops.filter((stop) => stop.outcome !== "cancelled");
  const cashCollected =
    Math.round(
      run.orders.reduce(
        (sum, order) =>
          sum +
          (order.attempts ?? [])
            .filter((a) => a.outcome === "delivered")
            .reduce((lineSum, a) => lineSum + (a.cash_collected ?? 0), 0),
        0,
      ) * 100,
    ) / 100;

  return {
    runId: run.id,
    truckLabel: run.truck?.code ? `${run.truck.name} (${run.truck.code})` : (run.truck?.name ?? "Truck"),
    stops,
    current,
    next,
    atStop: current?.atStop ?? false,
    delivered,
    failed,
    remaining: live.length - delivered,
    total: live.length,
    progressPct: live.length === 0 ? 0 : (delivered / live.length) * 100,
    cashCollected,
    finished: current === null,
  };
}
