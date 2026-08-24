import { rangeLengthDays, shiftDate } from "./date-range";

export type SalesKpis = { revenue: number; orders: number; kg: number };
export type SeriesPoint = { bucket: string; revenue: number; orders: number };
export type TopProduct = { name: string; revenue: number; kg: number };
export type TopParty = { name: string; revenue: number; orders: number };

/** Raw jsonb payload of the get_dashboard_sales RPC. */
export type SalesPayload = {
  kpis: SalesKpis;
  previous: SalesKpis;
  series: SeriesPoint[];
  funnel: Record<string, number>;
  topProducts: TopProduct[];
  topCustomers: TopParty[];
  topZones: TopParty[];
};

export type KpiCell = { value: number; previous: number; deltaPct: number | null };

export const FUNNEL_ORDER = [
  "pending",
  "confirmed",
  "ready",
  "delivered",
  "closed",
  "cancelled",
] as const;
export type FunnelStatus = (typeof FUNNEL_ORDER)[number];

export type SalesViewModel = {
  revenue: KpiCell;
  orders: KpiCell;
  kg: KpiCell;
  aov: KpiCell;
  rmPerKg: KpiCell;
  series: SeriesPoint[];
  funnel: Array<{ status: FunnelStatus; count: number }>;
  cancellationRate: number;
  topProducts: TopProduct[];
  topCustomers: TopParty[];
  topZones: TopParty[];
};

function cell(value: number, previous: number): KpiCell {
  return {
    value,
    previous,
    deltaPct: previous > 0 ? ((value - previous) / previous) * 100 : null,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function fillDaySeries(series: SeriesPoint[], from: string, to: string): SeriesPoint[] {
  const byBucket = new Map(series.map((p) => [p.bucket, p]));
  const out: SeriesPoint[] = [];
  const days = rangeLengthDays(from, to);
  for (let i = 0; i < days; i += 1) {
    const bucket = shiftDate(from, i);
    out.push(byBucket.get(bucket) ?? { bucket, revenue: 0, orders: 0 });
  }
  return out;
}

export function buildSalesViewModel(
  payload: SalesPayload,
  from: string,
  to: string,
  bucket: "day" | "week",
): SalesViewModel {
  const { kpis, previous } = payload;
  const funnelTotal = Object.values(payload.funnel).reduce((a, b) => a + b, 0);

  return {
    revenue: cell(kpis.revenue, previous.revenue),
    orders: cell(kpis.orders, previous.orders),
    kg: cell(kpis.kg, previous.kg),
    aov: cell(ratio(kpis.revenue, kpis.orders), ratio(previous.revenue, previous.orders)),
    rmPerKg: cell(ratio(kpis.revenue, kpis.kg), ratio(previous.revenue, previous.kg)),
    series: bucket === "day" ? fillDaySeries(payload.series, from, to) : payload.series,
    funnel: FUNNEL_ORDER.map((status) => ({
      status,
      count: payload.funnel[status] ?? 0,
    })),
    cancellationRate: ratio(payload.funnel.cancelled ?? 0, funnelTotal),
    topProducts: payload.topProducts,
    topCustomers: payload.topCustomers,
    topZones: payload.topZones,
  };
}
