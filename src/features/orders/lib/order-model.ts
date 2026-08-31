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

/**
 * `messageKey` is relative to the `orders.detail.delivered.warnings`
 * namespace; `values` carries the ICU params. Kept key-based (rather than a
 * resolved string) so this pure model stays translatable without importing
 * next-intl here — the one consumer (order-detail-client.tsx) resolves it.
 */
export type WeightWarning = {
  itemId: string;
  kind: "deviation" | "size_range";
  messageKey: string;
  values: Record<string, string | number>;
};

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
        messageKey: "deviation",
        values: { percent: (deviation * 100).toFixed(0) },
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
        messageKey: "sizeRange",
        values: {
          avgKg: avgKg.toFixed(2),
          min: item.size_min_kg,
          max: item.size_max_kg,
        },
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Re-exported rather than redefined: this was a byte-identical copy of the
 * seller helper, so the two could drift into formatting the same amount
 * differently on the orders screen and the catalog screen.
 */
export { formatPrice } from "@/features/seller/lib/pricing";

export function formatWeight(kg: number): string {
  return `${Number(kg.toFixed(3))} kg`;
}

export function describeFallback(applied: OrderFallback | null): string | null {
  if (applied === null) return null;
  return FALLBACK_LABELS[applied];
}
