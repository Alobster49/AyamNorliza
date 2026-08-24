/**
 * Pure presentation rules for the orders board/table. Everything here is
 * data-in data-out so it can be unit tested without React.
 */
import type { OrderListItem, OrderStatus } from "../types";
import { resolveDrop } from "./board-rules";
import { shiftIsoDate } from "@/lib/time/org-date";

export type AmountDisplay =
  | { kind: "total"; amount: number }
  | { kind: "unweighed" }
  | { kind: "none" };

/**
 * total_amount is only written by close_order — every earlier status holds 0.
 * Rendering that 0 as "RM 0.00" reads as a pricing bug, so open orders show
 * an unweighed hint instead and cancelled orders show nothing.
 */
export function displayAmount(
  order: Pick<OrderListItem, "status" | "total_amount">,
): AmountDisplay {
  if (order.status === "closed") return { kind: "total", amount: order.total_amount };
  if (order.status === "cancelled") return { kind: "none" };
  return { kind: "unweighed" };
}

export type DropTarget = { mode: "invite" | "decline" | "idle"; hintKey?: string };

/** What a column should signal while a card of `active` status is in flight. */
export function classifyDropTarget(
  active: OrderStatus,
  target: OrderStatus,
  callerRole: string,
): DropTarget {
  const resolution = resolveDrop(active, target, callerRole);
  if (resolution.kind === "noop") return { mode: "idle" };
  if (resolution.kind === "blocked") return { mode: "decline", hintKey: resolution.hintKey };
  return { mode: "invite" };
}

export type DateLens = "today" | "tomorrow" | "all";

const OPEN_STATUSES = new Set(["pending", "confirmed", "ready"]);

/**
 * "today" deliberately includes overdue orders that are still in flight —
 * they are exactly what the seller must deal with today. Terminal statuses
 * with past dates are history, not workload.
 */
export function applyLens(
  orders: OrderListItem[],
  lens: DateLens,
  today: string,
): OrderListItem[] {
  if (lens === "all") return orders;
  if (lens === "tomorrow") {
    const tomorrow = shiftIsoDate(today, 1);
    return orders.filter((o) => o.delivery_date === tomorrow);
  }
  return orders.filter(
    (o) => o.delivery_date === today || (o.delivery_date < today && OPEN_STATUSES.has(o.status)),
  );
}

export function isAtRisk(
  order: Pick<OrderListItem, "status" | "delivery_date">,
  today: string,
): "overdue" | "dueToday" | null {
  if (order.status !== "pending" && order.status !== "confirmed") return null;
  if (order.delivery_date < today) return "overdue";
  if (order.delivery_date === today) return "dueToday";
  return null;
}

export function matchesSearch(order: OrderListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (order.customer?.name ?? "").toLowerCase().includes(q) ||
    (order.zone?.name ?? "").toLowerCase().includes(q) ||
    order.id.toLowerCase().startsWith(q)
  );
}
