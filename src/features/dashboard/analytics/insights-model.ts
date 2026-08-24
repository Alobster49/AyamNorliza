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
  // market_base is per-variant; a product's benchmark is the mean of its
  // variants' bases so pairing is deterministic regardless of input order.
  const basesByProduct = new Map<string, number[]>();
  for (const s of suggestions) {
    if (s.market_base == null) continue;
    const base = Number(s.market_base);
    if (!Number.isFinite(base) || base <= 0) continue;
    const list = basesByProduct.get(s.product_name);
    if (list) list.push(base);
    else basesByProduct.set(s.product_name, [base]);
  }
  const marketByProduct = new Map(
    [...basesByProduct].map(([name, bases]) => [
      name,
      bases.reduce((a, b) => a + b, 0) / bases.length,
    ]),
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
