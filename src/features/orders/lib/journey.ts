/**
 * Order lifecycle journey model for the seller order detail page.
 * Pure data + mapping so the bar and banner can be unit tested without React.
 */

import type { OrderStatus } from "../types";

export const JOURNEY_STEPS = ["Placed", "Confirm", "Warehouse", "Deliver", "Settle"] as const;

/**
 * Index into JOURNEY_STEPS of the step the order is currently waiting on.
 * Returns JOURNEY_STEPS.length when the journey is complete (closed) and
 * null when the order has no journey (cancelled).
 */
export function journeyCurrentStep(status: OrderStatus): number | null {
  switch (status) {
    case "pending":
      return 1;
    case "confirmed":
      return 2;
    case "ready":
      return 3;
    case "delivered":
      return 4;
    case "closed":
      return JOURNEY_STEPS.length;
    case "cancelled":
      return null;
  }
}

export type JourneyBannerTone = "action" | "waiting" | "done";

export type JourneyBanner = {
  tone: JourneyBannerTone;
  title: string;
  body: string;
};

/** One-sentence guidance per state: what this screen wants and what happens next. */
export function journeyBanner(status: OrderStatus, itemCount: number): JourneyBanner | null {
  switch (status) {
    case "pending":
      return {
        tone: "action",
        title: `Check stock for ${itemCount} ${itemCount === 1 ? "item" : "items"}`,
        body: "Mark each line Available or Not available, then confirm. Confirming creates the warehouse task.",
      };
    case "confirmed":
      return {
        tone: "waiting",
        title: "Waiting for warehouse",
        body: "Warehouse allocates and weighs this order next. Nothing to do on this screen yet.",
      };
    case "ready":
      return {
        tone: "waiting",
        title: "Weighed and ready to load",
        body: "Waiting for loading and the delivery run. It becomes Delivered after the driver drops it off.",
      };
    case "delivered":
      return {
        tone: "action",
        title: "Enter final weight & price",
        body: "Fill in every line, then close the order to lock the bill.",
      };
    case "closed":
      return {
        tone: "done",
        title: "Order closed and billed",
        body: "The bill is locked. An admin can reopen it if settlement must be redone.",
      };
    case "cancelled":
      return null;
  }
}
