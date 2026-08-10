/**
 * Translates the machine-readable `errcode = 'P0001'` messages raised by
 * the order-pipeline RPCs (place_order, confirm_order, complete_order_task,
 * set_run_status, close_order, cancel_order, reopen_order) into a friendly
 * ActionResult-shaped error. portal-actions.ts keeps its own smaller
 * `mapPortalRpcError` (covering only the codes place_order/cancel_order can
 * raise) rather than importing this one, to avoid a forward dependency on a
 * file that didn't exist yet when portal-actions.ts (Task 7) was built.
 *
 * Lives in a plain (non-`"use server"`) module rather than in
 * `order-actions.ts` because Next.js requires every export of a `"use
 * server"` file to be an async function (each export becomes a Server
 * Action reference in the client bundle). This is a synchronous pure
 * function, so co-locating it there crashed every seller order-pipeline
 * page that imports from `order-actions.ts` at all (/orders/new,
 * /orders/[orderId], /tasks, /runs, the run manifest) with "Server Actions
 * must be async functions."
 */
export function mapRpcError(message: string): { code: string; message: string } {
  switch (message) {
    case "zone_not_found":
      return { code: "not_found", message: "That delivery zone was not found." };
    case "slot_not_found":
      return { code: "not_found", message: "That delivery slot is no longer available." };
    case "date_out_of_window":
      return { code: "validation", message: "Pick a delivery date within the next 14 days." };
    case "weekday_mismatch":
      return { code: "validation", message: "That date does not match the slot's day of the week." };
    case "date_blocked":
      return { code: "conflict", message: "Deliveries are blocked on that date. Pick another." };
    case "slot_full":
      return { code: "conflict", message: "That delivery slot just filled up — pick another." };
    case "invalid_items":
      return { code: "validation", message: "One or more items in this order are invalid." };
    case "invalid_status":
      return { code: "conflict", message: "This order is not in the right status for that action." };
    case "forbidden":
      return { code: "forbidden", message: "You do not have permission to do that." };
    case "decisions_incomplete":
      return { code: "validation", message: "Every line needs a stock decision before you can confirm." };
    case "weights_incomplete":
      return {
        code: "validation",
        message: "Every line needs a warehouse weight before you can finish this task.",
      };
    case "lines_incomplete":
      return {
        code: "validation",
        message: "Every line needs a final weight and price before you can close this order.",
      };
    case "task_done":
      return { code: "conflict", message: "This task is already done." };
    case "invalid_weight":
      return { code: "validation", message: "Weight must be greater than zero." };
    case "invalid_price":
      return { code: "validation", message: "Price per kg cannot be negative." };
    case "invalid_transition":
      return { code: "conflict", message: "That run status change is not allowed." };
    default:
      return { code: "internal", message: "Something went wrong. Please try again." };
  }
}
