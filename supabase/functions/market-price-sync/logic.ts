// Pure parsing/aggregation logic for the market-price-sync edge function.
// No Deno APIs here — this file is unit-tested with vitest from
// src/features/market/tests/unit/market-sync-logic.test.ts.

export type PriceRow = {
  date: string;
  premise_code: number;
  item_code: number;
  price: number;
};

export type PremiseRow = {
  premise_code: number;
  state: string;
  district: string | null;
};

export type PriceAggregate = {
  price_date: string;
  item_code: number;
  state: string;
  median_price: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  premise_count: number;
};

/** PriceCatcher items we track: 1=standard, 2=super, 3=live (all per 1kg). */
export const TRACKED_ITEM_CODES: Set<number> = new Set([1, 2, 3]);

/**
 * Month files to fetch. KPDN appends to the current month's file daily;
 * during the first 3 days we also refetch the previous month to pick up
 * late rows around the boundary.
 */
export function monthKeys(today: Date): string[] {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth(); // 0-based
  const key = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, "0")}`;
  const keys = [key(y, m)];
  if (today.getUTCDate() <= 3) {
    keys.push(m === 0 ? key(y - 1, 11) : key(y, m - 1));
  }
  return keys;
}

/** Minimal quote-aware CSV split (premise addresses contain commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Parse one pricecatcher_YYYY-MM.csv line: date,premise_code,item_code,price */
export function parsePriceRow(line: string): PriceRow | null {
  if (!line) return null;
  const parts = splitCsvLine(line.trim());
  if (parts.length < 4) return null;
  const date = parts[0]!;
  const premiseRaw = parts[1]!;
  const itemRaw = parts[2]!;
  const priceRaw = parts[3]!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null; // header or junk
  const premise_code = Math.trunc(Number.parseFloat(premiseRaw));
  const item_code = Math.trunc(Number.parseFloat(itemRaw));
  const price = Number.parseFloat(priceRaw);
  if (!Number.isFinite(premise_code) || !Number.isFinite(item_code) || !Number.isFinite(price)) {
    return null;
  }
  return { date, premise_code, item_code, price };
}

/** Parse one lookup_premise.csv line: premise_code,premise,address,premise_type,state,district */
export function parsePremiseRow(line: string): PremiseRow | null {
  if (!line) return null;
  const parts = splitCsvLine(line.trim());
  if (parts.length < 6) return null;
  const premise_code = Math.trunc(Number.parseFloat(parts[0]!));
  const state = parts[4]?.trim();
  if (!Number.isFinite(premise_code) || premise_code < 0 || !state) return null;
  const district = parts[5]?.trim();
  return { premise_code, state, district: district || null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Group tracked-item rows from allowed states into per-(date,item,state) aggregates. */
export function aggregate(
  rows: Iterable<PriceRow>,
  premiseState: Map<number, string>,
  allowedStates: Set<string>,
  itemCodes: Set<number>,
): PriceAggregate[] {
  const groups = new Map<string, { state: string; item: number; date: string; prices: number[] }>();
  for (const r of rows) {
    if (!itemCodes.has(r.item_code)) continue;
    const state = premiseState.get(r.premise_code);
    if (!state || !allowedStates.has(state)) continue;
    const key = `${r.date}|${r.item_code}|${state}`;
    const existing = groups.get(key);
    const g = existing ?? { state, item: r.item_code, date: r.date, prices: [] };
    g.prices.push(r.price);
    if (!existing) {
      groups.set(key, g);
    }
  }

  const out: PriceAggregate[] = [];
  for (const g of groups.values()) {
    const sorted = [...g.prices].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, p) => acc + p, 0);
    const minPrice = sorted[0] ?? 0;
    const maxPrice = sorted[sorted.length - 1] ?? 0;
    out.push({
      price_date: g.date,
      item_code: g.item,
      state: g.state,
      median_price: round2(median(sorted)),
      avg_price: round2(sum / sorted.length),
      min_price: round2(minPrice),
      max_price: round2(maxPrice),
      premise_count: sorted.length,
    });
  }
  return out.sort((a, b) =>
    a.price_date.localeCompare(b.price_date) || a.item_code - b.item_code || a.state.localeCompare(b.state),
  );
}
