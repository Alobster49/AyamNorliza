/**
 * Pure presentation model for the market prices page.
 *
 * Input is the raw `market_prices` rows for every state (one row per
 * state/item/day). Everything here is deterministic and framework-free so
 * the page can be unit-tested without Supabase or React.
 */

import type { MarketPriceRow } from "../types";

export type DailyPoint = {
  date: string;
  median: number;
  min: number;
  max: number;
  premises: number;
};

export type NationalPoint = {
  date: string;
  /** Premise-weighted mean of the state medians for that day. */
  median: number;
  /** Lower / upper quartile of the state medians (nearest rank). */
  q1: number;
  q3: number;
  low: number;
  high: number;
  premises: number;
  states: number;
};

export type Delta = { abs: number; pct: number };

export type WatchRow = {
  state: string;
  last: number;
  date: string;
  premises: number;
  d1: Delta | null;
  d7: Delta | null;
  spark: number[];
};

export type HeatGrid = {
  dates: string[];
  rows: { state: string; last: number; cells: (number | null)[] }[];
  /** Quantile cut points; `heatBin` turns a value into 0..thresholds.length. */
  thresholds: number[];
};

export type MarketSummary = {
  latestDate: string | null;
  dearest: { state: string; last: number } | null;
  cheapest: { state: string; last: number } | null;
  spread: number | null;
  premises: number;
};

const HEAT_BINS = 8;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Group rows of one item into a per-state, date-ascending series. */
export function seriesByState(
  rows: MarketPriceRow[],
  itemCode: number,
): Map<string, DailyPoint[]> {
  const map = new Map<string, DailyPoint[]>();
  for (const row of rows) {
    if (row.item_code !== itemCode) continue;
    const points = map.get(row.state) ?? [];
    points.push({
      date: row.price_date,
      median: Number(row.median_price),
      min: Number(row.min_price),
      max: Number(row.max_price),
      premises: row.premise_count,
    });
    map.set(row.state, points);
  }
  for (const points of map.values()) {
    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return map;
}

function quantile(sortedAsc: number[], p: number): number {
  const idx = Math.round(p * (sortedAsc.length - 1));
  return sortedAsc[idx] ?? 0;
}

/** One point per date across all states; skipped when no state has data. */
export function nationalSeries(byState: Map<string, DailyPoint[]>): NationalPoint[] {
  const byDate = new Map<string, DailyPoint[]>();
  for (const points of byState.values()) {
    for (const p of points) {
      const list = byDate.get(p.date) ?? [];
      list.push(p);
      byDate.set(p.date, list);
    }
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => {
      const list = byDate.get(date) ?? [];
      const premises = list.reduce((a, p) => a + p.premises, 0);
      const weighted = premises === 0
        ? list.reduce((a, p) => a + p.median, 0) / list.length
        : list.reduce((a, p) => a + p.median * p.premises, 0) / premises;
      const medians = list.map((p) => p.median).sort((a, b) => a - b);
      return {
        date,
        median: round2(weighted),
        q1: quantile(medians, 0.25),
        q3: quantile(medians, 0.75),
        low: medians[0] ?? 0,
        high: medians[medians.length - 1] ?? 0,
        premises,
        states: list.length,
      };
    });
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Change from the latest point to the latest point at least `days` days
 * earlier. Null when the series does not reach back that far, so a short
 * history shows "—" instead of a misleading 0%.
 */
export function deltaOver(
  points: { date: string; median: number }[],
  days: number,
): Delta | null {
  const current = points[points.length - 1];
  if (!current) return null;
  const target = shiftDate(current.date, days);
  let base: { date: string; median: number } | undefined;
  for (const p of points) {
    if (p.date <= target) base = p;
    else break;
  }
  if (!base || base.median === 0) return null;
  const abs = round2(current.median - base.median);
  return { abs, pct: round2((abs / base.median) * 100) };
}

/** Every state with data, dearest first. */
export function watchlist(byState: Map<string, DailyPoint[]>): WatchRow[] {
  const rows: WatchRow[] = [];
  for (const [state, points] of byState) {
    const latest = points[points.length - 1];
    if (!latest) continue;
    rows.push({
      state,
      last: latest.median,
      date: latest.date,
      premises: latest.premises,
      d1: deltaOver(points, 1),
      d7: deltaOver(points, 7),
      spark: points.map((p) => p.median),
    });
  }
  return rows.sort((a, b) => b.last - a.last || a.state.localeCompare(b.state));
}

/** Cut points that split `values` into `bins` equal-count buckets. */
export function quantileThresholds(values: number[], bins = HEAT_BINS): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const out: number[] = [];
  for (let k = 1; k < bins; k++) out.push(quantile(sorted, k / bins));
  return out;
}

/** 0-based bin index for a value against `quantileThresholds` output. */
export function heatBin(value: number, thresholds: number[]): number {
  let bin = 0;
  for (const t of thresholds) {
    if (value > t) bin++;
    else break;
  }
  return bin;
}

/** Last `days` distinct dates × every state, dearest state first. */
export function heatGrid(byState: Map<string, DailyPoint[]>, days = 12): HeatGrid {
  const dateSet = new Set<string>();
  for (const points of byState.values()) for (const p of points) dateSet.add(p.date);
  const dates = [...dateSet].sort().slice(-days);
  const rows = watchlist(byState).map((row) => {
    const points = byState.get(row.state) ?? [];
    const byDate = new Map(points.map((p) => [p.date, p.median]));
    return {
      state: row.state,
      last: row.last,
      cells: dates.map((d) => byDate.get(d) ?? null),
    };
  });
  const values = rows.flatMap((r) => r.cells.filter((c): c is number => c != null));
  return { dates, rows, thresholds: quantileThresholds(values) };
}

export function summarize(byState: Map<string, DailyPoint[]>): MarketSummary {
  const rows = watchlist(byState);
  const dearest = rows[0] ?? null;
  const cheapest = rows[rows.length - 1] ?? null;
  const latestDate = rows.reduce<string | null>(
    (acc, r) => (acc == null || r.date > acc ? r.date : acc),
    null,
  );
  return {
    latestDate,
    dearest: dearest && { state: dearest.state, last: dearest.last },
    cheapest: cheapest && { state: cheapest.state, last: cheapest.last },
    spread: dearest && cheapest ? round2(dearest.last - cheapest.last) : null,
    premises: rows
      .filter((r) => r.date === latestDate)
      .reduce((a, r) => a + r.premises, 0),
  };
}

/** Super minus standard on the latest day both grades have a national point. */
export function gradePremium(
  standard: NationalPoint[],
  superGrade: NationalPoint[],
): number | null {
  const supByDate = new Map(superGrade.map((p) => [p.date, p.median]));
  for (let i = standard.length - 1; i >= 0; i--) {
    const std = standard[i];
    if (!std) continue;
    const sup = supByDate.get(std.date);
    if (sup != null) return round2(sup - std.median);
  }
  return null;
}

const SPARK_PAD = 2;

/** SVG polyline points for a sparkline; "" when there is no line to draw. */
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usable = height - SPARK_PAD * 2;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = span === 0 ? height / 2 : SPARK_PAD + (1 - (v - min) / span) * usable;
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");
}
