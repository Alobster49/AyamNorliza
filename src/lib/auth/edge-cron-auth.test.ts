/**
 * Unit tests for the Edge Function cron guard, which lives in the Deno tree
 * at `supabase/functions/_shared/cron-auth.ts` and is imported here the same
 * way `market-sync-logic.test.ts` imports the market function's logic.
 *
 * Why it exists: access-review-reminder, temporary-access-expiry and
 * market-price-sync run with `verify_jwt = false` and a service-role client.
 * They are the only part of this system reachable from the open internet, and
 * until this guard they would run for anyone who knew the URL -- sending real
 * email to real org members, or triggering the KPDN ingest, once per request.
 *
 * Only the pure predicate is tested; the Response-building wrapper around it
 * needs Deno globals.
 */

import { describe, expect, it } from "vitest";

import { isAuthorizedCron } from "../../../supabase/functions/_shared/cron-auth";

const SECRET = "s3cr3t-cron-value-of-reasonable-length";

describe("isAuthorizedCron", () => {
  it("accepts a request carrying the exact secret", () => {
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(true);
  });

  it("rejects a request with no header at all", () => {
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorizedCron("not-the-secret", SECRET)).toBe(false);
  });

  it("rejects a value that only shares a prefix", () => {
    // Guards against ever reducing this to a startsWith/substring compare.
    expect(isAuthorizedCron(SECRET.slice(0, 10), SECRET)).toBe(false);
  });

  it("rejects a value that merely extends the secret", () => {
    expect(isAuthorizedCron(SECRET + "x", SECRET)).toBe(false);
  });

  it("fails closed when no secret is configured, rather than letting everyone in", () => {
    // The dangerous default: an unset CRON_SECRET must never mean "allow".
    expect(isAuthorizedCron("anything", undefined)).toBe(false);
    expect(isAuthorizedCron(null, undefined)).toBe(false);
  });

  it("treats an empty configured secret as unconfigured", () => {
    expect(isAuthorizedCron("", "")).toBe(false);
  });
});
