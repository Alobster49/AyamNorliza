/**
 * Pure model behind the delivery-runs board (the "Run Rail" screen).
 *
 * Turns a RunWithOrders into the numbers the dispatcher actually asks for —
 * how far the run has got, what it weighs against the truck, how much cash is
 * out there — plus the departure gate and the "needs a human" alert list.
 * No React, no I/O: unit tested in tests/unit/run-board-model.test.ts.
 *
 * Stop order comes from orders.run_sequence, the route order the dispatcher
 * sets. Orders that have no sequence yet fall in behind it, ordered by slot
 * window the way the screen behaved before sequencing existed.
 */

import type { DeliveryAttempt, OrderWithItems, RunStatus, RunWithOrders } from "../types";
import { DELIVERY_FAILURE_LABELS } from "../types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** An order that is cancelled is not a stop the truck has to make. */
export function isLiveOrder(order: OrderWithItems): boolean {
  return order.status !== "cancelled";
}

export function isDropped(order: OrderWithItems): boolean {
  return order.status === "delivered" || order.status === "closed";
}

/** Recorded weight for one order: final wins over warehouse, cancelled lines skipped. */
export function orderWeightKg(order: OrderWithItems): number {
  return (order.items ?? [])
    .filter((item) => !item.is_cancelled)
    .reduce((sum, item) => sum + (item.final_weight_kg ?? item.warehouse_weight_kg ?? 0), 0);
}

export function liveItemCount(order: OrderWithItems): number {
  return (order.items ?? []).filter((item) => !item.is_cancelled).length;
}

function hasUnweighedLine(order: OrderWithItems): boolean {
  return (order.items ?? []).some(
    (item) => !item.is_cancelled && item.final_weight_kg === null && item.warehouse_weight_kg === null,
  );
}

/** The most recent attempt at this stop, or null if nobody has tried yet. */
export function latestAttempt(order: OrderWithItems): DeliveryAttempt | null {
  const attempts = (order.attempts ?? [])
    .slice()
    .sort((a, b) => a.attempted_at.localeCompare(b.attempted_at));
  return attempts.at(-1) ?? null;
}

/**
 * A stop the driver could not deliver. The order status wins: a stop that was
 * knocked back at 10am and delivered on the retry at 3pm is not a failure.
 */
export function failedAtDoor(order: OrderWithItems): boolean {
  if (isDropped(order)) return false;
  return latestAttempt(order)?.outcome === "failed";
}

/**
 * What the driver is actually carrying for this stop. A delivery recorded at
 * the door carries the amount the driver keyed in -- part payment and short
 * payment are ordinary here -- and only a stop closed from the office with no
 * attempt at all falls back to the invoice total.
 */
export function collectedAtDoor(order: OrderWithItems): number {
  const delivered = (order.attempts ?? []).filter((a) => a.outcome === "delivered");
  if (delivered.length === 0) return order.total_amount ?? 0;
  return delivered.reduce((sum, a) => sum + (a.cash_collected ?? 0), 0);
}

export function truckLabel(run: RunWithOrders): string {
  if (!run.truck) return "Unassigned truck";
  return run.truck.code ? `${run.truck.name} (${run.truck.code})` : run.truck.name;
}

export function customerName(order: OrderWithItems): string {
  return order.customer?.name ?? "Unknown customer";
}

/** "09:00:00" -> "09:00". Times arrive from Postgres as time strings. */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Run vitals
// ---------------------------------------------------------------------------

export type RunVitals = {
  /** Stops the truck has to make (cancelled orders excluded). */
  total: number;
  delivered: number;
  remaining: number;
  /** Cancelled orders sitting on the run — a stop that did not happen. */
  failed: number;
  loaded: number;
  unloaded: number;
  progressPct: number;
  weightKg: number;
  capacityKg: number | null;
  /** Null when the truck has no capacity recorded; 0 for an empty run. */
  loadPct: number | null;
  overloaded: boolean;
  cashCollected: number;
  cashOutstanding: number;
  window: { start: string; end: string } | null;
};

export function runVitals(run: RunWithOrders): RunVitals {
  const live = run.orders.filter(isLiveOrder);
  const delivered = live.filter(isDropped);
  const weightKg = round2(live.reduce((sum, order) => sum + orderWeightKg(order), 0));
  const capacityKg = run.truck?.capacity_kg ?? null;

  const starts = live.map((o) => o.slot?.start_time).filter((t): t is string => Boolean(t));
  const ends = live.map((o) => o.slot?.end_time).filter((t): t is string => Boolean(t));
  const window =
    starts.length > 0 && ends.length > 0
      ? {
          start: shortTime(starts.slice().sort()[0] as string),
          end: shortTime(ends.slice().sort().at(-1) as string),
        }
      : null;

  const loadPct = capacityKg !== null && capacityKg > 0 ? round2((weightKg / capacityKg) * 100) : null;

  return {
    total: live.length,
    delivered: delivered.length,
    remaining: live.length - delivered.length,
    failed: run.orders.length - live.length + live.filter(failedAtDoor).length,
    loaded: live.filter((o) => o.loaded_at !== null).length,
    unloaded: live.filter((o) => o.loaded_at === null).length,
    progressPct: live.length === 0 ? 0 : (delivered.length / live.length) * 100,
    weightKg,
    capacityKg,
    loadPct: capacityKg === null ? null : (loadPct ?? 0),
    overloaded: loadPct !== null && loadPct > 100,
    cashCollected: round2(delivered.reduce((sum, o) => sum + collectedAtDoor(o), 0)),
    cashOutstanding: round2(
      live.filter((o) => !isDropped(o)).reduce((sum, o) => sum + (o.total_amount ?? 0), 0),
    ),
    window,
  };
}

// ---------------------------------------------------------------------------
// Departure gate
// ---------------------------------------------------------------------------

export type BlockedOrder = { orderId: string; label: string };

export type DepartureCheck = {
  canDepart: boolean;
  unloaded: BlockedOrder[];
  unweighed: BlockedOrder[];
};

/**
 * A truck must not leave the yard holding orders the loading screen never
 * signed off, or lines nobody weighed. A run that already departed is past
 * the gate — re-checking it would only strand it.
 */
export function departureCheck(run: RunWithOrders): DepartureCheck {
  if (run.status !== "planned") return { canDepart: true, unloaded: [], unweighed: [] };

  const live = run.orders.filter(isLiveOrder);
  const unloaded = live
    .filter((o) => o.loaded_at === null)
    .map((o) => ({ orderId: o.id, label: customerName(o) }));
  const unweighed = live
    .filter(hasUnweighedLine)
    .map((o) => ({ orderId: o.id, label: customerName(o) }));

  return { canDepart: unloaded.length === 0 && unweighed.length === 0, unloaded, unweighed };
}

/**
 * What actually happens when the dispatcher marks the run departed: the RPC
 * strips every order that is not yet 'ready' off the run (run_id, loaded mark
 * and assignment all cleared). The confirm step has to say so by name.
 */
export function departureImpact(run: RunWithOrders): { droppedFromRun: BlockedOrder[] } {
  return {
    droppedFromRun: run.orders
      .filter((o) => o.status !== "ready")
      .map((o) => ({ orderId: o.id, label: customerName(o) })),
  };
}

/** Completing a run sweeps every remaining 'ready' order to 'delivered'. */
export function completionImpact(run: RunWithOrders): { markedDelivered: number } {
  return { markedDelivered: run.orders.filter((o) => o.status === "ready").length };
}

// ---------------------------------------------------------------------------
// Stop rows
// ---------------------------------------------------------------------------

export type StopStateKind = "dropped" | "failed" | "on_truck" | "not_loaded" | "waiting";

export type StopState = { kind: StopStateKind; label: string; tone: "ok" | "hot" | "warn" | "accent" | "muted" };

const STOP_STATE: Record<StopStateKind, Omit<StopState, "kind">> = {
  dropped: { label: "Dropped", tone: "ok" },
  failed: { label: "Failed", tone: "hot" },
  on_truck: { label: "On the truck", tone: "accent" },
  not_loaded: { label: "Not loaded", tone: "warn" },
  waiting: { label: "Waiting", tone: "muted" },
};

export function stopState(order: OrderWithItems, runStatus: RunStatus): StopState {
  const kind: StopStateKind = isDropped(order)
    ? "dropped"
    : order.status === "cancelled" || failedAtDoor(order)
      ? "failed"
      : runStatus !== "planned"
        ? "on_truck"
        : order.loaded_at === null
          ? "not_loaded"
          : "waiting";

  // A reported failure says more than the word "Failed": show the reason the
  // driver gave, because that is what the office has to act on.
  const reason = kind === "failed" ? latestAttempt(order)?.reason : null;
  return {
    kind,
    ...STOP_STATE[kind],
    ...(reason ? { label: DELIVERY_FAILURE_LABELS[reason] } : {}),
  };
}

export type StopRow = {
  sequence: number;
  orderId: string;
  customerName: string;
  phone: string | null;
  address: string;
  zoneName: string;
  itemCount: number;
  weightKg: number;
  amount: number;
  window: { start: string; end: string } | null;
  state: StopState;
};

/**
 * The run's orders in route order. The manifest prints from this too, so the
 * paper in the driver's hand matches the screen the office is looking at.
 */
export function sortedRunOrders(run: RunWithOrders): OrderWithItems[] {
  return run.orders
    .slice()
    .sort((a, b) => {
      // The dispatcher's route order wins. Orders with no sequence yet (just
      // assigned, or assigned before this shipped) fall in behind it, still
      // ordered the way the screen used to show them.
      const seqA = a.run_sequence ?? Number.MAX_SAFE_INTEGER;
      const seqB = b.run_sequence ?? Number.MAX_SAFE_INTEGER;
      if (seqA !== seqB) return seqA - seqB;
      const byStart = (a.slot?.start_time ?? "99:99").localeCompare(b.slot?.start_time ?? "99:99");
      if (byStart !== 0) return byStart;
      const byZone = (a.zone?.name ?? "").localeCompare(b.zone?.name ?? "");
      if (byZone !== 0) return byZone;
      return customerName(a).localeCompare(customerName(b));
    });
}

export function runStopRows(run: RunWithOrders): StopRow[] {
  return sortedRunOrders(run)
    .map((order, index) => ({
      sequence: index + 1,
      orderId: order.id,
      customerName: customerName(order),
      phone: order.customer?.phone ?? null,
      address: order.delivery_address,
      zoneName: order.zone?.name ?? "-",
      itemCount: liveItemCount(order),
      weightKg: round2(orderWeightKg(order)),
      amount: order.total_amount ?? 0,
      window: order.slot ? { start: shortTime(order.slot.start_time), end: shortTime(order.slot.end_time) } : null,
      state: stopState(order, run.status),
    }));
}

/**
 * Reorder helper for the stop list. Returns a new array of order ids in the
 * order dispatch_reorder_run expects; the RPC insists on the complete set, so
 * this never adds or drops an id.
 */
export function moveStop(orderIds: string[], from: number, to: number): string[] {
  if (from < 0 || from >= orderIds.length) return orderIds.slice();
  const next = orderIds.slice();
  const [moved] = next.splice(from, 1);
  const target = Math.min(Math.max(to, 0), next.length);
  next.splice(target, 0, moved as string);
  return next;
}

// ---------------------------------------------------------------------------
// Board alerts — "needs a human"
// ---------------------------------------------------------------------------

export type AlertKind = "unloaded" | "unweighed" | "overloaded" | "failed" | "overdue";

export type BoardAlert = {
  runId: string;
  truckLabel: string;
  kind: AlertKind;
  message: string;
};

export type AlertOptions = {
  /** Minutes since midnight, local to the depot. Omit to skip the time-based checks. */
  nowMinutes?: number;
};

/**
 * The one block worth reading first: everything on the board that a person has
 * to do something about. Ordered by how much it costs to ignore.
 */
export function boardAlerts(runs: RunWithOrders[], options: AlertOptions = {}): BoardAlert[] {
  const alerts: BoardAlert[] = [];

  for (const run of runs) {
    const label = truckLabel(run);
    const vitals = runVitals(run);
    const gate = departureCheck(run);

    if (gate.unloaded.length > 0) {
      alerts.push({
        runId: run.id,
        truckLabel: label,
        kind: "unloaded",
        message: `${gate.unloaded.length} order${gate.unloaded.length === 1 ? "" : "s"} not loaded yet — the truck cannot depart`,
      });
    }

    if (gate.unweighed.length > 0) {
      alerts.push({
        runId: run.id,
        truckLabel: label,
        kind: "unweighed",
        message: `${gate.unweighed.length} order${gate.unweighed.length === 1 ? "" : "s"} still unweighed`,
      });
    }

    if (vitals.overloaded) {
      alerts.push({
        runId: run.id,
        truckLabel: label,
        kind: "overloaded",
        message: `${vitals.weightKg} kg loaded against a ${vitals.capacityKg} kg truck`,
      });
    }

    if (vitals.failed > 0 && run.status !== "planned") {
      alerts.push({
        runId: run.id,
        truckLabel: label,
        kind: "failed",
        message: `${vitals.failed} stop${vitals.failed === 1 ? "" : "s"} did not get delivered`,
      });
    }

    const windowEnd = vitals.window ? minutesOfDay(vitals.window.end) : null;
    if (
      run.status === "departed" &&
      vitals.remaining > 0 &&
      options.nowMinutes !== undefined &&
      windowEnd !== null &&
      options.nowMinutes > windowEnd
    ) {
      alerts.push({
        runId: run.id,
        truckLabel: label,
        kind: "overdue",
        message: `${vitals.remaining} stop${vitals.remaining === 1 ? "" : "s"} still out past the ${vitals.window?.end} window`,
      });
    }
  }

  return alerts;
}
