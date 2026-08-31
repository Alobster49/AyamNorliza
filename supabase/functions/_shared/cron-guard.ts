// supabase/functions/_shared/cron-guard.ts
// Deno-side wrapper over the pure predicate in `cron-auth.ts`.
//
// Kept separate because `cron-auth.ts` is imported by a Node-side vitest
// suite (src/lib/auth/edge-cron-auth.test.ts) and must not reference Deno
// globals -- the same reason market-price-sync keeps `logic.ts` free of them.

import { isAuthorizedCron } from "./cron-auth.ts";

/**
 * Guards a scheduled function's handler. Returns a `Response` to send back
 * when the caller is not the scheduler, or `null` when the request may
 * proceed.
 *
 * A missing `CRON_SECRET` is reported as 503 rather than 401 so an
 * unconfigured deployment is distinguishable from an unauthorized caller in
 * the function logs -- these run unattended, and a silent daily 401 is the
 * failure mode most likely to go unnoticed.
 */
export function cronGuard(req: Request): Response | null {
  const expected = Deno.env.get("CRON_SECRET");

  if (!expected) {
    console.error("CRON_SECRET is not set; refusing to run this scheduled function");
    return new Response(JSON.stringify({ error: "cron secret not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isAuthorizedCron(req.headers.get("x-cron-secret"), expected)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}
