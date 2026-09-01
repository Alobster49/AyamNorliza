import type { Database } from "@/types/database.generated";

export type MarketPriceRow = Database["public"]["Tables"]["market_prices"]["Row"];
export type MarketSuggestion =
  Database["public"]["Functions"]["get_market_suggestions"]["Returns"][number];

export type MarketMarginType = "rm" | "pct";

/**
 * PriceCatcher benchmark items selectable on a variant (all per 1kg).
 *
 * Item 3 (AYAM HIDUP) exists in KPDN's lookup_item.csv but has never carried
 * a single price row -- live birds trade at farm/wholesale, not at the retail
 * premises PriceCatcher surveys. Verified 0 rows nationwide across 2025-08,
 * 2026-01, 2026-07 and 2026-08. Tracking it only produced a permanently empty
 * card, so it is excluded here and in the sync's TRACKED_ITEM_CODES.
 */
export const MARKET_ITEMS = [
  { code: 1, label: "Ayam standard" },
  { code: 2, label: "Ayam super" },
] as const;

export function marketItemLabel(code: number | null): string {
  return MARKET_ITEMS.find((i) => i.code === code)?.label ?? "—";
}

/** State strings exactly as they appear in PriceCatcher's premise lookup. */
export const MARKET_STATES = [
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang",
  "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor",
  "Terengganu", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya",
] as const;

export type MarketState = (typeof MARKET_STATES)[number];

/** Short codes for the ticker strip; JPJ-style plate prefixes people already know. */
export const MARKET_STATE_ABBR: Record<MarketState, string> = {
  Johor: "JHR", Kedah: "KDH", Kelantan: "KTN", Melaka: "MLK", "Negeri Sembilan": "NSN",
  Pahang: "PHG", Perak: "PRK", Perlis: "PLS", "Pulau Pinang": "PNG", Sabah: "SBH",
  Sarawak: "SWK", Selangor: "SGR", Terengganu: "TRG", "W.P. Kuala Lumpur": "KUL",
  "W.P. Labuan": "LBN", "W.P. Putrajaya": "PJY",
};

export function marketStateAbbr(state: string): string {
  return MARKET_STATE_ABBR[state as MarketState] ?? state.slice(0, 3).toUpperCase();
}
