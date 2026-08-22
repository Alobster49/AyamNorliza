import type { Database } from "@/types/database.generated";

export type MarketPriceRow = Database["public"]["Tables"]["market_prices"]["Row"];
export type MarketSuggestion =
  Database["public"]["Functions"]["get_market_suggestions"]["Returns"][number];

export type MarketMarginType = "rm" | "pct";

/** PriceCatcher benchmark items selectable on a variant (all per 1kg). */
export const MARKET_ITEMS = [
  { code: 1, label: "Ayam standard" },
  { code: 2, label: "Ayam super" },
  { code: 3, label: "Ayam hidup" },
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
