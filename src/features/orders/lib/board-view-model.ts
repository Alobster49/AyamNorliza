/**
 * Pure presentation rules for the orders board/table. Everything here is
 * data-in data-out so it can be unit tested without React.
 */
import type { OrderListItem } from "../types";

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
