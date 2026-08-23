import type { OrderStatus } from "@/features/orders/types";

export const TRACKER_STEPS = ["Ditempah", "Dihantar", "Harga disahkan"] as const;

/** Buyer-facing lifecycle: weighing/settlement (closed) happens AFTER
 *  delivery in this pipeline, so the price-confirmed step is last. */
export function trackerIndex(status: OrderStatus): number | null {
  switch (status) {
    case "pending":
    case "confirmed":
    case "ready":
      return 0;
    case "delivered":
      return 1;
    case "closed":
      return 2;
    case "cancelled":
      return null;
  }
}
