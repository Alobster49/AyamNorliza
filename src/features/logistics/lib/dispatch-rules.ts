/**
 * Pure drop rules for the dispatch board, mirroring the orders kanban's
 * board-rules.ts: a drag never writes state directly — it resolves to an
 * action (assign/unassign), a confirmation workflow (override), or a
 * blocked reason shown as a toast.
 */

import type { OrderStatus, RunStatus } from "@/features/orders/types";

export type DispatchDropTarget =
  | { type: "pool" }
  | { type: "truck"; truckId: string; compatible: boolean; atCapacity: boolean; departed: boolean };

export type DispatchDropResolution =
  | { kind: "noop" }
  | { kind: "assign"; truckId: string }
  | { kind: "override"; truckId: string }
  | { kind: "unassign" }
  // reasonKey is relative to `logistics.dispatch.blocked`.
  | { kind: "blocked"; reasonKey: string };

export function resolveDispatchDrop(
  ticket: { status: OrderStatus; assignedTruckId: string | null; runStatus: RunStatus | null },
  target: DispatchDropTarget,
): DispatchDropResolution {
  if (ticket.status !== "confirmed" && ticket.status !== "ready") {
    return { kind: "blocked", reasonKey: "notDispatchable" };
  }
  if (ticket.runStatus === "departed") {
    return { kind: "blocked", reasonKey: "runDeparted" };
  }

  if (target.type === "pool") {
    return ticket.assignedTruckId === null ? { kind: "noop" } : { kind: "unassign" };
  }

  if (ticket.assignedTruckId === target.truckId) return { kind: "noop" };
  if (target.departed) {
    return { kind: "blocked", reasonKey: "truckDeparted" };
  }
  if (target.atCapacity) {
    return { kind: "blocked", reasonKey: "truckAtCapacity" };
  }
  if (!target.compatible) return { kind: "override", truckId: target.truckId };
  return { kind: "assign", truckId: target.truckId };
}
