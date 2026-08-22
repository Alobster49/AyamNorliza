/**
 * Unit tests for `resolveZoneForPostcode` (portal-actions). The Supabase
 * server client is mocked so no database is required; `requireBuyer` is
 * exercised for real through the mocked client's `auth.getUser` +
 * `from("buyers")` chain, matching the mock idiom in schedule-actions.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveZoneForPostcode } from "../../server/portal-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A minimal chainable Supabase query-builder stub. Every builder method
 * (select/insert/update/delete/eq/...) returns the same object so calls
 * can be chained in any order; `.single()`/`.maybeSingle()` resolve the
 * configured result, and the object is itself thenable so code that
 * `await`s the builder directly also resolves the configured result.
 */
function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "or", "order", "is", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * Builds a mock Supabase client. `auth.getUser` + `from("buyers")` are
 * wired to satisfy `requireBuyer`; `from("organizations")` resolves the
 * org lookup in `resolveZoneForPostcode`; `rpc` is a plain mock the test
 * configures directly.
 */
function mockSupabaseFor({
  userId = "user-1",
  buyerId = "buyer-1",
  orgId = "org-1",
  rpcResult = { data: null, error: null } as { data: unknown; error: { message: string } | null },
}: {
  userId?: string | null;
  buyerId?: string | null;
  orgId?: string | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
} = {}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "buyers") {
        return chain({
          data: buyerId ? { id: buyerId, organization_id: orgId } : null,
          error: null,
        });
      }
      if (table === "organizations") {
        return chain({ data: orgId ? { id: orgId } : null, error: null });
      }
      return chain({ data: null, error: null });
    }),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveZoneForPostcode", () => {
  it("returns validation error without touching the DB for a malformed postcode", async () => {
    const supabase = mockSupabaseFor();

    const result = await resolveZoneForPostcode("ayam-norliza-pilot", "1234");

    expect(result).toEqual({
      ok: false,
      code: "validation",
      message: "Enter a 5-digit postcode",
    });
    expect(supabase.from).not.toHaveBeenCalledWith("organizations");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns zoneId null when the RPC finds no covering zone", async () => {
    mockSupabaseFor({ rpcResult: { data: null, error: null } });

    const result = await resolveZoneForPostcode("ayam-norliza-pilot", "82000");

    expect(result).toEqual({ ok: true, data: { zoneId: null } });
  });

  it("returns the zone id when the RPC resolves one", async () => {
    mockSupabaseFor({
      rpcResult: { data: "44444444-4444-4444-4444-444444444444", error: null },
    });

    const result = await resolveZoneForPostcode("ayam-norliza-pilot", "82000");

    expect(result).toEqual({
      ok: true,
      data: { zoneId: "44444444-4444-4444-4444-444444444444" },
    });
  });

  it("returns unauthenticated when signed out", async () => {
    mockSupabaseFor({ userId: null });

    const result = await resolveZoneForPostcode("ayam-norliza-pilot", "82000");

    expect(result).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "Not authenticated",
    });
  });
});
