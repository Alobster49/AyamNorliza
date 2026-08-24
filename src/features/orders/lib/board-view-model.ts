/**
 * Pure presentation rules for the orders board/table. Everything here is
 * data-in data-out so it can be unit tested without React.
 */
import type { OrderListItem, OrderStatus } from "../types";
import { resolveDrop } from "./board-rules";

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
