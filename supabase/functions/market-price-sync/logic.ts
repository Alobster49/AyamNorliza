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

/**
 * PriceCatcher items we track: 1=standard, 2=super (both per 1kg).
 * Item 3 (live chicken) is catalogued by KPDN but never priced -- see the
 * MARKET_ITEMS comment in src/features/market/types.ts.
 */
export const TRACKED_ITEM_CODES: Set<number> = new Set([1, 2]);

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

/**
 * Bootstrap read size for a month with no cursor.
 *
 * Starting at byte 0 is what kills the worker -- 50 MB and ~1.5M rows for a
 * full month. ~4 MB is a little over two days of nationwide rows, enough to
 * land current prices on the first run after deploy without pretending to
 * backfill history.
 */
export const BOOTSTRAP_TAIL_BYTES = 4_000_000;

export type MonthCursor = { bytes_read: number; file_size: number };

/**
 * What to fetch for a month, given its current size and our cursor.
 *
 * - `resume` starts at a known line boundary, so every byte read is a whole row.
 * - `tail` starts mid-line by construction; the caller must discard bytes up to
 *   the first newline.
 * - `uptodate` means the file has not grown since the last read.
 */
export type RangePlan =
  | { kind: "full" }
  | { kind: "tail"; start: number }
  | { kind: "resume"; start: number }
  | { kind: "uptodate" };

export function planRange(
  fileSize: number,
  cursor: MonthCursor | null,
  tailBytes: number = BOOTSTRAP_TAIL_BYTES,
): RangePlan {
  // A file smaller than what we last saw was rewritten, not appended: the
  // offset no longer means anything, so fall back to the no-cursor path.
  const usable = cursor && cursor.file_size <= fileSize ? cursor : null;

  if (usable) {
    if (usable.bytes_read >= fileSize) return { kind: "uptodate" };
    return { kind: "resume", start: usable.bytes_read };
  }
  if (fileSize <= tailBytes) return { kind: "full" };
  return { kind: "tail", start: fileSize - tailBytes };
}

/** Total size out of a 206 response's `Content-Range: bytes 0-99/12345`. */
export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const slash = header.lastIndexOf("/");
  if (slash < 0) return null;
  const total = Number.parseInt(header.slice(slash + 1), 10);
  return Number.isFinite(total) ? total : null;
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
  // Hot path: runs over every line of a month file -- millions of rows, of
  // which ~180k are ours. The price CSV is four unquoted columns, so the
  // quote-aware splitter is pure cost here, and its char-by-char loop is what
  // pushed the worker past its CPU budget (WORKER_RESOURCE_LIMIT / 546 on
  // 2026-09-01). Premise addresses still need splitCsvLine; prices do not.
  const parts = line.split(",");
  if (parts.length < 4) return null;
  const date = parts[0]!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null; // header or junk
  // Reject untracked items before parsing the rest: ~99% of rows exit here.
  // This couples the parser to TRACKED_ITEM_CODES, which is the only set any
  // caller passes to the aggregator; the aggregator keeps its own check so
  // `aggregate()` stays honest about the set it is given.
  const item_code = Math.trunc(Number.parseFloat(parts[2]!));
  if (!TRACKED_ITEM_CODES.has(item_code)) return null;
  const premise_code = Math.trunc(Number.parseFloat(parts[1]!));
  const price = Number.parseFloat(parts[3]!);
  if (!Number.isFinite(premise_code) || !Number.isFinite(price)) return null;
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

/**
 * Streaming accumulator for per-(date,item,state) aggregates.
 *
 * The sync ingests every state, so the caller streams the whole month file
 * through `add` rather than buffering the ~180k tracked rows a month holds.
 * Memory stays at one number per surveyed price, not one object.
 */
export type Aggregator = {
  add(row: PriceRow): void;
  finish(): PriceAggregate[];
};

export function createAggregator(
  premiseState: Map<number, string>,
  itemCodes: Set<number>,
): Aggregator {
  const groups = new Map<string, { state: string; item: number; date: string; prices: number[] }>();

  return {
    add(r: PriceRow) {
      if (!itemCodes.has(r.item_code)) return;
      // A premise missing from the lookup has no state to attribute it to.
      const state = premiseState.get(r.premise_code);
      if (!state) return;
      const key = `${r.date}|${r.item_code}|${state}`;
      const existing = groups.get(key);
      const g = existing ?? { state, item: r.item_code, date: r.date, prices: [] };
      g.prices.push(r.price);
      if (!existing) {
        groups.set(key, g);
      }
    },

    finish() {
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
    },
  };
}

/** Convenience wrapper over `createAggregator` for callers holding rows in memory. */
export function aggregate(
  rows: Iterable<PriceRow>,
  premiseState: Map<number, string>,
  itemCodes: Set<number>,
): PriceAggregate[] {
  const agg = createAggregator(premiseState, itemCodes);
  for (const r of rows) agg.add(r);
  return agg.finish();
}
