import type { MarketSuggestion } from "@/features/market/types";

export type PricingRow = { name: string; kg: number; revenue: number; realizedPerKg: number | null };
export type WeightByProduct = { name: string; warehouseKg: number; finalKg: number; diffKg: number };
export type SilentCustomer = { name: string; lastOrderDate: string; lifetimeRevenue: number };
export type ZoneQuality = { zone: string; total: number; failed: number };

export type InsightsPayload = {
  pricing: PricingRow[];
  weight: { warehouseKg: number; finalKg: number; diffKg: number; byProduct: WeightByProduct[] };
  retention: { active: number; newCustomers: number; returning: number; silent: SilentCustomer[] };
  delivery: { attempts: number; failed: number; byZone: ZoneQuality[]; slotOrders: number; slotCapacity: number };
};

export type InsightsViewModel = {
  pricing: Array<PricingRow & { marketBase: number | null; gapPct: number | null }>;
  weight: InsightsPayload["weight"] & { leakagePct: number };
  retention: InsightsPayload["retention"];
  delivery: InsightsPayload["delivery"] & { failureRate: number; slotFillPct: number | null };
};

export function buildInsightsViewModel(
  payload: InsightsPayload,
  suggestions: MarketSuggestion[],
): InsightsViewModel {
  const marketByProduct = new Map(
    suggestions
      .filter((s) => s.market_base != null)
      .map((s) => [s.product_name, Number(s.market_base)]),
  );
  return {
    pricing: payload.pricing.map((row) => {
      const marketBase = marketByProduct.get(row.name) ?? null;
      const gapPct =
        marketBase !== null && marketBase > 0 && row.realizedPerKg !== null
          ? ((row.realizedPerKg - marketBase) / marketBase) * 100
          : null;
      return { ...row, marketBase, gapPct };
    }),
    weight: {
      ...payload.weight,
      leakagePct:
        payload.weight.warehouseKg > 0
          ? (payload.weight.diffKg / payload.weight.warehouseKg) * 100
          : 0,
    },
    retention: payload.retention,
    delivery: {
      ...payload.delivery,
      failureRate:
        payload.delivery.attempts > 0 ? payload.delivery.failed / payload.delivery.attempts : 0,
      slotFillPct:
        payload.delivery.slotCapacity > 0
          ? (payload.delivery.slotOrders / payload.delivery.slotCapacity) * 100
          : null,
    },
  };
}
