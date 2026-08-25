"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import type { MarketPriceRow, MarketSuggestion } from "../types";
import { MARKET_ITEMS, MARKET_STATES } from "../types";

const DEFAULT_STATE = "Selangor";
const TRACKED_ITEM_CODES = MARKET_ITEMS.map((i) => i.code);

export async function getMarketState(orgId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("market_settings")
    .select("states")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.states?.[0] ?? DEFAULT_STATE;
}

export async function setMarketState(orgId: string, state: string, orgSlug?: string) {
  if (!MARKET_STATES.includes(state as (typeof MARKET_STATES)[number]))
    throw new Error("Unknown state");
  const supabase = await createClient();
  const { error } = await supabase
    .from("market_settings")
    .upsert({ org_id: orgId, states: [state], updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  if (orgSlug) revalidatePath(`/${orgSlug}/market-prices`);
}

export async function getMarketTrend(
  states: string[],
  days = 30,
): Promise<MarketPriceRow[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabase
    .from("market_prices")
    .select("*")
    .in("item_code", TRACKED_ITEM_CODES)
    .in("state", states)
    .gte("price_date", since)
    .order("price_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getMarketSuggestions(orgId: string): Promise<MarketSuggestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_market_suggestions", {
    p_organization_id: orgId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
