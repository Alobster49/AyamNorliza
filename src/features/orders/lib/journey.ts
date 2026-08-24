/**
 * Order lifecycle journey model for the seller order detail page.
 * Pure data + mapping so the bar and banner can be unit tested without React.
 */

import type { OrderStatus } from "../types";

export const JOURNEY_STEPS = ["placed", "confirm", "warehouse", "deliver", "settle"] as const;

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

/**
 * Message keys are relative to the `orders.journey.banner` namespace so the
 * component can resolve them with a single `useTranslations("orders.journey.banner")`
 * call. `titleValues` carries the ICU params for the pending count.
 */
export type JourneyBanner = {
  tone: JourneyBannerTone;
  titleKey: string;
  titleValues?: Record<string, number>;
  bodyKey: string;
};

/** One-sentence guidance per state: what this screen wants and what happens next. */
export function journeyBanner(status: OrderStatus, itemCount: number): JourneyBanner | null {
  switch (status) {
    case "pending":
      return {
        tone: "action",
        titleKey: "pending.title",
        titleValues: { count: itemCount },
        bodyKey: "pending.body",
      };
    case "confirmed":
      return {
        tone: "waiting",
        titleKey: "confirmed.title",
        bodyKey: "confirmed.body",
      };
    case "ready":
      return {
        tone: "waiting",
        titleKey: "ready.title",
        bodyKey: "ready.body",
      };
    case "delivered":
      return {
        tone: "action",
        titleKey: "delivered.title",
        bodyKey: "delivered.body",
      };
    case "closed":
      return {
        tone: "done",
        titleKey: "closed.title",
        bodyKey: "closed.body",
      };
    case "cancelled":
      return null;
  }
}
