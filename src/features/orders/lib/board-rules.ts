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
  | { kind: "blocked"; reasonKey: string; hintKey: string };

const blocked = (slug: string): DropResolution => ({
  kind: "blocked",
  reasonKey: `orders.board.blocked.${slug}`,
  hintKey: `orders.board.hint.${slug}`,
});

export function resolveDrop(
  from: OrderStatus,
  to: OrderStatus,
  canReopen: boolean,
): DropResolution {
  if (from === to) return { kind: "noop" };

  if (from === "pending" && to === "confirmed") return { kind: "confirm" };

  if ((from === "pending" || from === "confirmed") && to === "cancelled") {
    return { kind: "cancel" };
  }

  if (from === "delivered" && to === "closed") return { kind: "settle" };

  if (from === "closed" && to === "delivered") {
    if (canReopen) return { kind: "reopen" };
    return blocked("reopenRole");
  }

  if (to === "ready") return blocked("ready");
  if (to === "delivered") return blocked("delivered");
  if (to === "pending") return blocked("pending");
  if (to === "confirmed") return blocked("confirmed");
  if (to === "cancelled") return blocked("cancelled");
  // to === "closed"
  return blocked("closed");
}
