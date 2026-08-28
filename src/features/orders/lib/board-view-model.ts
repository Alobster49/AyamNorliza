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
 * total_amount is only reliably final once an order is "closed" — that
 * status is reachable only through close_order or through
 * driver_deliver_stop settling every line (see
 * 20260827000002_driver_deliver_closes_order.sql), both of which require
 * every non-cancelled line to have a final weight *and* a price.
 *
 * "delivered" does NOT give that guarantee, from two different paths:
 *   - driver_deliver_stop leaves an order at "delivered" (instead of
 *     promoting it to "closed") exactly when at least one non-cancelled line
 *     still has price_per_kg null — total_amount sums only the priced
 *     lines, so it understates the real total.
 *   - the office's "complete run" bulk sweep (set_run_status, see
 *     20260823000003_run_complete_skips_failed_stops.sql) flips ready orders
 *     straight to "delivered" without touching total_amount at all, so it
 *     can still be sitting at its 0 default.
 *
 * Either way, rendering total_amount for a "delivered" order can show a
 * wrong or stale RM figure as if it were final. So only "closed" shows a
 * total; every other open status (including "delivered") shows the
 * unweighed hint, and cancelled orders show nothing.
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

/** wa.me needs digits with country code; MY local numbers start with 0. */
export function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCountry = digits.startsWith("0") ? `6${digits}` : digits;
  return `https://wa.me/${withCountry}`;
}
