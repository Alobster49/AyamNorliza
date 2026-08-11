/**
 * Pure drop rules for the orders kanban board. A drag from one status
 * column to another never writes status directly — it resolves to a
 * workflow (dialog / navigation) or a blocked reason shown as a toast.
 */

import type { OrderStatus } from "../types";

export type DropResolution =
  | { kind: "noop" }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "settle" }
  | { kind: "reopen" }
  | { kind: "blocked"; reason: string };

const REOPEN_ROLES = ["owner", "org_admin"];

export function resolveDrop(
  from: OrderStatus,
  to: OrderStatus,
  callerRole: string,
): DropResolution {
  if (from === to) return { kind: "noop" };

  if (from === "pending" && to === "confirmed") return { kind: "confirm" };

  if ((from === "pending" || from === "confirmed") && to === "cancelled") {
    return { kind: "cancel" };
  }

  if (from === "delivered" && to === "closed") return { kind: "settle" };

  if (from === "closed" && to === "delivered") {
    if (REOPEN_ROLES.includes(callerRole)) return { kind: "reopen" };
    return { kind: "blocked", reason: "Only owners or admins can reopen closed orders." };
  }

  if (to === "ready") {
    return { kind: "blocked", reason: "Ready is set by the warehouse weigh task." };
  }
  if (to === "delivered") {
    return { kind: "blocked", reason: "Delivered is set when the delivery run completes." };
  }
  if (to === "pending") {
    return { kind: "blocked", reason: "Orders cannot move back to pending." };
  }
  if (to === "confirmed") {
    return { kind: "blocked", reason: "Only pending orders can be confirmed." };
  }
  if (to === "cancelled") {
    return { kind: "blocked", reason: "Only pending or confirmed orders can be cancelled." };
  }
  // to === "closed"
  return { kind: "blocked", reason: "Only delivered orders can be closed." };
}
