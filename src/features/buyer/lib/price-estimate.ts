/**
 * Pure price-estimate math for the Terus Segar buy flow. Prices in the
 * portal are ALWAYS estimates until the order is weighed and closed; the
 * "~" tilde and the ScaleChip carry that meaning — never disclaimer prose.
 */

import type { OrderFallback, OrderItemMode } from "@/features/orders/types";
import type { CartLine } from "@/features/buyer/components/cart-context";

export type EstimateInput = {
  mode: OrderItemMode;
  quantity: number;
  sizeMinKg: number;
  sizeMaxKg: number;
  pricePerUnit: number;
  unitType: "per_kg" | "per_piece";
};

const toSen = (n: number) => Math.round(n * 100) / 100;

export function estimateRange(i: EstimateInput): { min: number; max: number } {
  if (i.unitType === "per_piece") {
    const flat = toSen(i.quantity * i.pricePerUnit);
    return { min: flat, max: flat };
  }
  if (i.mode === "kg") {
    const flat = toSen(i.quantity * i.pricePerUnit);
    return { min: flat, max: flat };
  }
  return {
    min: toSen(i.quantity * i.sizeMinKg * i.pricePerUnit),
    max: toSen(i.quantity * i.sizeMaxKg * i.pricePerUnit),
  };
}

/** Null when any line predates the price fields (old stored cart) or cart empty. */
export function cartEstimate(lines: CartLine[]): { min: number; max: number } | null {
  if (lines.length === 0) return null;
  let min = 0;
  let max = 0;
  for (const line of lines) {
    if (line.pricePerUnit === undefined || line.unitType === undefined) return null;
    const r = estimateRange({
      mode: line.mode,
      quantity: line.quantity,
      sizeMinKg: line.sizeMinKg,
      sizeMaxKg: line.sizeMaxKg,
      pricePerUnit: line.pricePerUnit,
      unitType: line.unitType,
    });
    min += r.min;
    max += r.max;
  }
  return { min: toSen(min), max: toSen(max) };
}

const rm = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatRM(n: number): string {
  return `RM ${rm.format(n)}`;
}

export function formatEstimate(r: { min: number; max: number }): string {
  if (r.min === r.max) return `~${formatRM(r.min)}`;
  return `~RM ${rm.format(r.min)}–${rm.format(r.max)}`;
}

export function deltaAgainstEstimate(
  est: { min: number; max: number },
  finalTotal: number,
): { kind: "below" | "above" | "within"; amount: number } {
  if (finalTotal < est.min) return { kind: "below", amount: toSen(est.min - finalTotal) };
  if (finalTotal > est.max) return { kind: "above", amount: toSen(finalTotal - est.max) };
  return { kind: "within", amount: 0 };
}

/** Message keys (relative to the `buyer.product` namespace) for the buyer-facing
 *  fallback labels. FALLBACK_LABELS in orders/types.ts is shared with the seller
 *  UI and must not change. */
export const BUYER_FALLBACK_KEYS: Record<OrderFallback, string> = {
  cancel: "fallback.cancel",
  mix: "fallback.mix",
  upsize: "fallback.upsize",
  downsize: "fallback.downsize",
};
