"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/require-permission";
import type { PermissionAction } from "@/lib/auth/rbac";
import type { MarketPriceRow, MarketSuggestion } from "../types";
import { MARKET_ITEMS, MARKET_STATES } from "../types";

const DEFAULT_STATE = "Selangor";
const TRACKED_ITEM_CODES = MARKET_ITEMS.map((i) => i.code);

/**
 * Same contract as the seller actions: the caller passes the organization
 * slug, and the org id comes back from the dynamic-RBAC guard rather than
 * from the client. `market_settings` is per-org, so an unguarded action
 * taking an org id would let any signed-in user repoint another org's
 * price state.
 */
async function guard(organizationSlug: string, action: PermissionAction) {
  const { orgId } = await requirePermission(organizationSlug, "market_prices", action);
  return orgId;
}

function dbError(fallback: string): Error {
  return new Error(fallback);
}

export async function getMarketState(organizationSlug: string): Promise<string> {
  const orgId = await guard(organizationSlug, "view");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("market_settings")
    .select("states")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw dbError("Could not load the market price settings.");
  return data?.states?.[0] ?? DEFAULT_STATE;
}

export async function setMarketState(organizationSlug: string, state: string) {
  if (!MARKET_STATES.includes(state as (typeof MARKET_STATES)[number])) {
    throw new Error("Unknown state");
  }
  const orgId = await guard(organizationSlug, "edit");
  const supabase = await createClient();
  const { error } = await supabase
    .from("market_settings")
    .upsert({ org_id: orgId, states: [state], updated_at: new Date().toISOString() });
  if (error) throw dbError("Could not save the market price settings.");
  revalidatePath(`/${organizationSlug}/market-prices`);
}

/**
 * National reference data with no org column of its own — the guard is here
 * so it stays behind org membership rather than being readable by any
 * signed-in user of any org.
 */
export async function getMarketTrend(
  organizationSlug: string,
  states: string[],
  days = 30,
): Promise<MarketPriceRow[]> {
  await guard(organizationSlug, "view");
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
  if (error) throw dbError("Could not load market price history.");
  return data ?? [];
}

export async function getMarketSuggestions(
  organizationSlug: string,
): Promise<MarketSuggestion[]> {
  const orgId = await guard(organizationSlug, "view");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_market_suggestions", {
    p_organization_id: orgId,
  });
  if (error) throw dbError("Could not load price suggestions.");
  return data ?? [];
}
