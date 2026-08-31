// supabase/functions/market-price-sync/index.ts
// Scheduled Edge Function: downloads the KPDN PriceCatcher monthly CSV,
// filters to tracked chicken items, and upserts per-(date,item,state)
// aggregates into market_prices for every Malaysian state.
//
// All states are ingested regardless of what any org has configured: the
// month file is downloaded whole anyway, and storing the lot costs ~32 rows
// a day. market_settings.states is a display preference only -- gating
// ingest on it left every unconfigured state permanently empty in the UI.
//
// Schedule (pg_cron, 20260823000002): daily 05:15 UTC = 13:15 MYT,
// after KPDN's ~12:00 MYT daily upload.
// Data: https://data.gov.my/data-catalogue/pricecatcher (CC BY 4.0).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createAggregator,
  monthKeys,
  parsePremiseRow,
  parsePriceRow,
  TRACKED_ITEM_CODES,
} from "./logic.ts";
import { cronGuard } from "../_shared/cron-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DATA_BASE = "https://storage.data.gov.my/pricecatcher";
const PREMISE_TTL_DAYS = 30;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function* lines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) yield line;
  }
  if (buf) yield buf;
}

/**
 * "cached" = the premise map was already fresh, nothing fetched.
 * "refreshed" = lookup_premise.csv was downloaded and upserted this run.
 * "stale" = the refresh failed but an older cache is still usable.
 */
type PremiseState = "cached" | "refreshed" | "stale";

async function refreshPremisesIfStale(): Promise<PremiseState> {
  const { data, error } = await admin
    .from("market_premises")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`market_premises check: ${error.message}`);

  const hasCache = (data?.length ?? 0) > 0;
  const newest = data?.[0]?.synced_at ? new Date(data[0].synced_at) : null;
  const staleBefore = Date.now() - PREMISE_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (newest && newest.getTime() > staleBefore) return "cached";

  // A cache already exists (merely stale) -- a lookup_premise.csv failure
  // here must not abort the price sync; fall back to the existing cache.
  // Only propagate when there is NO cache at all, since the sync cannot
  // proceed meaningfully without any premise->state mapping.
  try {
    const res = await fetch(`${DATA_BASE}/lookup_premise.csv`);
    if (!res.ok) throw new Error(`lookup_premise.csv HTTP ${res.status}`);

    const now = new Date().toISOString();
    const rows: { premise_code: number; state: string; district: string | null; synced_at: string }[] = [];
    for await (const line of lines(res)) {
      const parsed = parsePremiseRow(line);
      if (parsed) rows.push({ ...parsed, synced_at: now });
    }
    if (rows.length === 0) throw new Error("lookup_premise.csv parsed to 0 rows");

    for (let i = 0; i < rows.length; i += 500) {
      const { error: upsertError } = await admin
        .from("market_premises")
        .upsert(rows.slice(i, i + 500), { onConflict: "premise_code" });
      if (upsertError) throw new Error(`market_premises upsert: ${upsertError.message}`);
    }
    return "refreshed";
  } catch (e) {
    if (!hasCache) throw e;
    console.error("premise refresh failed, using existing (stale) cache", e);
    return "stale";
  }
}

async function premiseStateMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  // ~3k premises; page through to stay under PostgREST's row cap.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("market_premises")
      .select("premise_code, state")
      .range(from, from + 999);
    if (error) throw new Error(`market_premises read: ${error.message}`);
    for (const r of data ?? []) map.set(r.premise_code, r.state);
    if (!data || data.length < 1000) break;
  }
  return map;
}

Deno.serve(async (req) => {
  const denied = cronGuard(req);
  if (denied) return denied;

  try {
    // Refreshing the premise lookup and parsing a month of price rows are
    // each affordable alone but together exceed the edge runtime's budget:
    // the very first prod run died with WORKER_RESOURCE_LIMIT doing both.
    // So a run that actually refreshes stops there, and the next daily tick
    // (premises now fresh) ingests prices. Cost: one skipped price day per
    // PREMISE_TTL_DAYS, instead of one killed worker.
    if (await refreshPremisesIfStale() === "refreshed") {
      return new Response(
        JSON.stringify({ premisesRefreshed: true, pricesSkipped: "next run" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const premises = await premiseStateMap();
    const aggregator = createAggregator(premises, TRACKED_ITEM_CODES);

    const candidateMonths = monthKeys(new Date());
    const months: string[] = [];
    for (const month of candidateMonths) {
      // Each month file is fetched independently: on days 1-3 the current
      // month's file may not exist yet at 13:15 MYT, but the previous
      // month (which holds the month's last day) must still be fetched.
      // A missing file for one month must not abort the whole run.
      let res: Response;
      try {
        res = await fetch(`${DATA_BASE}/pricecatcher_${month}.csv`);
      } catch (e) {
        console.error(`pricecatcher_${month}.csv fetch failed`, e);
        continue;
      }
      if (!res.ok) {
        console.error(`pricecatcher_${month}.csv HTTP ${res.status}`);
        continue;
      }
      months.push(month);
      for await (const line of lines(res)) {
        const parsed = parsePriceRow(line);
        // Accumulate as we stream: a month of nationwide rows never all sits
        // in memory at once, only one number per surveyed price.
        if (parsed) aggregator.add(parsed);
      }
    }
    if (months.length === 0) {
      throw new Error(`No month files fetched successfully (tried: ${candidateMonths.join(", ")})`);
    }

    const aggregates = aggregator.finish();
    for (let i = 0; i < aggregates.length; i += 500) {
      const { error } = await admin
        .from("market_prices")
        .upsert(aggregates.slice(i, i + 500), { onConflict: "price_date,item_code,state" });
      if (error) throw new Error(`market_prices upsert: ${error.message}`);
    }

    return new Response(JSON.stringify({ upserted: aggregates.length, months }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("market-price-sync failed", e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
