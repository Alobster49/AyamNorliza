/**
 * Settlement helpers for the delivered-order panel: market price hints and
 * completion checks. Pure functions, no React or Supabase.
 */

import type { MarketSuggestion } from "@/features/market/types";

/**
 * Suggested price/kg for an order line, matched by product name.
 * Suggestions come per variant; the first fresh one whose product matches
 * wins (the RPC orders by product then variant name). Stale rows and rows
 * with no computed suggestion never produce a hint.
 */
export function pickPriceHint(
  suggestions: readonly MarketSuggestion[],
  productName: string | null | undefined,
): number | null {
  if (!productName) return null;
  for (const s of suggestions) {
    if (s.product_name === productName && !s.stale && s.suggested_price != null) {
      return s.suggested_price;
    }
  }
  return null;
}

export type SettlementLineDraft = {
  finalWeightKg: number | null;
  pricePerKg: number | null;
};

/** True once every line has a positive weight and a non-negative price. */
export function settlementReady(lines: readonly SettlementLineDraft[]): boolean {
  return (
    lines.length > 0 &&
    lines.every(
      (line) =>
        line.finalWeightKg != null &&
        line.finalWeightKg > 0 &&
        line.pricePerKg != null &&
        line.pricePerKg >= 0,
    )
  );
}
