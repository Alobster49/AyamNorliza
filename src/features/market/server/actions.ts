"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import type { MarketPriceRow, MarketSuggestion } from "../types";

const DEFAULT_STATE = "Selangor";
const TRACKED_ITEM_CODES = [1, 2, 3];

export async function getMarketState(orgId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("market_settings")
    .select("states")
    .eq("org_id", orgId)
    .maybeSingle();
  return data?.states?.[0] ?? DEFAULT_STATE;
}

export async function setMarketState(orgId: string, state: string, orgSlug?: string) {
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
  const { data } = await supabase
    .from("market_prices")
    .select("*")
    .in("item_code", TRACKED_ITEM_CODES)
    .in("state", states)
    .gte("price_date", since)
    .order("price_date", { ascending: true });
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

/**
 * Apply a suggested price to a variant. Always user-initiated — the sync
 * job never touches price_per_unit. RLS restricts the update to sellers
 * of the variant's org.
 */
export async function applySuggestedPrice(variantId: string, price: number, orgSlug?: string) {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price");
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ price_per_unit: Math.round(price * 100) / 100 })
    .eq("id", variantId);
  if (error) throw new Error(error.message);
  if (orgSlug) {
    revalidatePath(`/${orgSlug}/market-prices`);
    revalidatePath(`/${orgSlug}/products`);
  }
}
