/**
 * Pure order-pipeline model: status transitions, settlement math, weight
 * sanity warnings, and display formatters. No I/O — safe to unit test
 * without mocking Supabase.
 */

import type { OrderFallback, OrderItem, OrderStatus } from "../types";
import { FALLBACK_LABELS } from "../types";

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: ["closed", "cancelled"],
  closed: ["delivered"],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Settlement math
// ---------------------------------------------------------------------------

export function computeLineTotal(finalWeightKg: number, pricePerKg: number): number {
  return Math.round(finalWeightKg * pricePerKg * 100) / 100;
}

export function computeOrderTotal(
  lines: Array<{
    final_weight_kg: number | null;
    price_per_kg: number | null;
    is_cancelled: boolean;
  }>,
): number {
  const total = lines.reduce((sum, line) => {
    if (line.is_cancelled) return sum;
    if (line.final_weight_kg === null || line.price_per_kg === null) return sum;
    return sum + computeLineTotal(line.final_weight_kg, line.price_per_kg);
  }, 0);
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// Weight sanity warnings
// ---------------------------------------------------------------------------

export type WeightWarning = { itemId: string; kind: "deviation" | "size_range"; message: string };

export function weightWarnings(
  item: Pick<
    OrderItem,
    | "id"
    | "mode"
    | "quantity"
    | "size_min_kg"
    | "size_max_kg"
    | "warehouse_weight_kg"
    | "final_weight_kg"
    | "final_pieces"
    | "warehouse_pieces"
  >,
): WeightWarning[] {
  const warnings: WeightWarning[] = [];

  if (item.warehouse_weight_kg !== null && item.final_weight_kg !== null) {
    const deviation =
      Math.abs(item.final_weight_kg - item.warehouse_weight_kg) / item.warehouse_weight_kg;
    if (deviation > 0.2) {
      warnings.push({
        itemId: item.id,
        kind: "deviation",
        message: `Final weight deviates ${(deviation * 100).toFixed(0)}% from the warehouse weight`,
      });
    }
  }

  const pieces =
    item.final_pieces ?? item.warehouse_pieces ?? (item.mode === "piece" ? item.quantity : null);
  if (pieces && item.final_weight_kg !== null) {
    const avgKg = item.final_weight_kg / pieces;
    if (avgKg < item.size_min_kg || avgKg > item.size_max_kg) {
      warnings.push({
        itemId: item.id,
        kind: "size_range",
        message: `Average bird weight ${avgKg.toFixed(2)} kg is outside the ordered size range (${item.size_min_kg}–${item.size_max_kg} kg)`,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const myr = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export function formatPrice(amount: number): string {
  return myr.format(amount);
}

export function formatWeight(kg: number): string {
  return `${Number(kg.toFixed(3))} kg`;
}

export function describeFallback(applied: OrderFallback | null): string | null {
  if (applied === null) return null;
  return FALLBACK_LABELS[applied];
}
