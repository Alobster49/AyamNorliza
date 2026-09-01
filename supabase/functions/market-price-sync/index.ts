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
  type MonthCursor,
  monthKeys,
  parseContentRangeTotal,
  parsePremiseRow,
  parsePriceRow,
  planRange,
  TRACKED_ITEM_CODES,
  type Aggregator,
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

type MonthReport = {
  month: string;
  plan: "full" | "tail" | "resume" | "uptodate";
  bytesStreamed: number;
  rowsMatched: number;
  fileSize: number;
  nextBytesRead: number;
};

async function readCursors(months: string[]): Promise<Map<string, MonthCursor>> {
  const { data, error } = await admin
    .from("market_sync_cursor")
    .select("month, bytes_read, file_size")
    .in("month", months);
  if (error) throw new Error(`market_sync_cursor read: ${error.message}`);
  const out = new Map<string, MonthCursor>();
  for (const r of data ?? []) {
    out.set(r.month, { bytes_read: Number(r.bytes_read), file_size: Number(r.file_size) });
  }
  return out;
}

/**
 * Read one month file from `cursor` forward and feed the aggregator.
 *
 * Returns null when the month could not be read at all -- a missing file for
 * the current month on day 1 is normal, not an error.
 */
async function ingestMonth(
  month: string,
  cursor: MonthCursor | null,
  aggregator: Aggregator,
): Promise<MonthReport | null> {
  const url = `${DATA_BASE}/pricecatcher_${month}.csv`;

  // HEAD first: the plan depends on how big the file is now versus what we
  // read last time, and asking for a range we have not sized could mean
  // swallowing the whole 50 MB.
  let head: Response;
  try {
    head = await fetch(url, { method: "HEAD" });
  } catch (e) {
    console.error(`pricecatcher_${month}.csv HEAD failed`, e);
    return null;
  }
  if (!head.ok) {
    console.error(`pricecatcher_${month}.csv HEAD HTTP ${head.status}`);
    return null;
  }
  const headSize = Number.parseInt(head.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(headSize)) {
    console.error(`pricecatcher_${month}.csv HEAD gave no usable content-length`);
    return null;
  }

  const plan = planRange(headSize, cursor);
  if (plan.kind === "uptodate") {
    return {
      month,
      plan: "uptodate",
      bytesStreamed: 0,
      rowsMatched: 0,
      fileSize: headSize,
      nextBytesRead: cursor?.bytes_read ?? 0,
    };
  }

  const start = plan.kind === "full" ? 0 : plan.start;
  let res: Response;
  try {
    res = await fetch(url, start > 0 ? { headers: { Range: `bytes=${start}-` } } : {});
  } catch (e) {
    console.error(`pricecatcher_${month}.csv fetch failed`, e);
    return null;
  }
  if (!res.ok) {
    console.error(`pricecatcher_${month}.csv HTTP ${res.status}`);
    return null;
  }
  // A range we asked for but did not get means the body is the entire file.
  // Reading it is the exact 50 MB that kills the worker, so bail instead.
  if (start > 0 && res.status !== 206) {
    await res.body?.cancel();
    console.error(
      `pricecatcher_${month}.csv ignored Range (HTTP ${res.status}); skipping rather than reading ${headSize} bytes`,
    );
    return null;
  }

  const fileSize = (res.status === 206 ? parseContentRangeTotal(res.headers.get("content-range")) : null) ?? headSize;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let bytesStreamed = 0;
  let rowsMatched = 0;
  let asciiOnly = true;

  // Byte offset of the line about to be emitted. Only meaningful while the
  // stream stays ASCII -- see the cursor choice at the end.
  let lineStart = start;
  // A tail start lands mid-line by construction; a cursor start does not.
  let pendingPartialLine = plan.kind === "tail";
  let newestDate = "";
  let newestDateStart = start;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesStreamed += value.byteLength;
    const text = decoder.decode(value, { stream: true });
    // One test per chunk, not per line. PriceCatcher price rows are dates and
    // numbers, so this should never trip; if it does, the byte arithmetic
    // below is off and we fall back to the exact end-of-read offset.
    if (asciiOnly && /[^\x00-\x7F]/.test(text)) asciiOnly = false;
    buf += text;

    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const lineBytes = line.length + 1; // ASCII: one byte per char, plus "\n"
      if (pendingPartialLine) {
        pendingPartialLine = false;
        lineStart += lineBytes;
        continue;
      }
      const parsed = parsePriceRow(line);
      if (parsed) {
        aggregator.add(parsed);
        rowsMatched++;
        // The file is date-ordered, so the last date change marks where the
        // newest day begins.
        if (parsed.date !== newestDate) {
          newestDate = parsed.date;
          newestDateStart = lineStart;
        }
      }
      lineStart += lineBytes;
    }
  }
  buf += decoder.decode();

  // Whatever is left in `buf` is a partial line: not parsed, and not counted
  // as read, so the next run picks it up whole.
  const leftoverBytes = new TextEncoder().encode(buf).length;
  const endOfRead = start + bytesStreamed - leftoverBytes;

  // Hold the cursor at the newest date's first row so a day still being
  // appended is re-read and re-aggregated next run, rather than left frozen
  // with a half-counted premise_count. Costs one day of bytes; the upsert is
  // idempotent. Falls back to the exact end when the byte arithmetic cannot
  // be trusted or nothing matched.
  const nextBytesRead = asciiOnly && rowsMatched > 0
    ? Math.min(Math.max(newestDateStart, start), endOfRead)
    : endOfRead;

  return { month, plan: plan.kind, bytesStreamed, rowsMatched, fileSize, nextBytesRead };
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
    const cursors = await readCursors(candidateMonths);

    const months: MonthReport[] = [];
    for (const month of candidateMonths) {
      // Each month is ingested independently: on days 1-3 the current month's
      // file may not exist yet at 13:15 MYT, but the previous month (which
      // holds the month's last day) must still be read. One month failing
      // must not abort the whole run.
      const report = await ingestMonth(month, cursors.get(month) ?? null, aggregator);
      if (report) months.push(report);
    }
    if (months.length === 0) {
      throw new Error(`No month files read successfully (tried: ${candidateMonths.join(", ")})`);
    }

    const aggregates = aggregator.finish();
    for (let i = 0; i < aggregates.length; i += 500) {
      const { error } = await admin
        .from("market_prices")
        .upsert(aggregates.slice(i, i + 500), { onConflict: "price_date,item_code,state" });
      if (error) throw new Error(`market_prices upsert: ${error.message}`);
    }

    // The cursor is saved only after the prices it accounts for are committed.
    // Saving first would let a failed upsert skip a day permanently.
    for (const report of months) {
      if (report.plan === "uptodate") continue;
      const { error } = await admin
        .from("market_sync_cursor")
        .upsert(
          {
            month: report.month,
            bytes_read: report.nextBytesRead,
            file_size: report.fileSize,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "month" },
        );
      if (error) throw new Error(`market_sync_cursor upsert (${report.month}): ${error.message}`);
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
