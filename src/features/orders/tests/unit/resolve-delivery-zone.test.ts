/**
 * Unit tests for `resolveDeliveryZone` (order-actions). The Supabase server
 * client is mocked; `requireOrgRole` (in ./guards) is exercised for real
 * through the mocked client's `auth.getUser` + `from("organizations")` +
 * `from("organization_members")` chain, matching the mock idiom in
 * order-actions.test.ts. The chainable query-builder stub itself mirrors
 * portal-resolve-zone.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDeliveryZone } from "../../server/order-actions";

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
 * Builds a mock Supabase client. `auth.getUser` + `from("organizations")` +
 * `from("organization_members")` are wired to satisfy `requireOrgRole`
 * (the guard `resolveDeliveryZone` uses); `rpc` is a plain mock the test
 * configures directly.
 */
function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  role = "owner",
  rpcResult = { data: null, error: null } as { data: unknown; error: { message: string } | null },
}: {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
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
      if (table === "organizations") {
        return chain({ data: orgId ? { id: orgId, default_time_zone: "Asia/Kuala_Lumpur" } : null, error: null });
      }
      if (table === "organization_members") {
        return chain({ data: role ? { role } : null, error: null });
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

describe("resolveDeliveryZone", () => {
  it("returns the resolved zone id for a covered postcode", async () => {
    mockSupabaseFor({
      role: "owner",
      rpcResult: { data: "44444444-4444-4444-4444-444444444444", error: null },
    });

    const result = await resolveDeliveryZone("acme", "80000");

    expect(result).toEqual({
      ok: true,
      data: { zoneId: "44444444-4444-4444-4444-444444444444" },
    });
  });

  it("returns a null zone id when no zone covers the postcode", async () => {
    mockSupabaseFor({ role: "owner", rpcResult: { data: null, error: null } });

    const result = await resolveDeliveryZone("acme", "50000");

    expect(result).toEqual({ ok: true, data: { zoneId: null } });
  });

  it("rejects a malformed postcode without calling the rpc", async () => {
    const supabase = mockSupabaseFor({ role: "owner" });

    const result = await resolveDeliveryZone("acme", "800");

    expect(result.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("passes the guarded org id to the rpc", async () => {
    const supabase = mockSupabaseFor({
      role: "owner",
      orgId: "org-42",
      rpcResult: { data: null, error: null },
    });

    await resolveDeliveryZone("acme", "80000");

    expect(supabase.rpc).toHaveBeenCalledWith("resolve_zone_for_postcode", {
      p_org: "org-42",
      p_postcode: "80000",
    });
  });

  it("refuses a caller without a manager role", async () => {
    const supabase = mockSupabaseFor({ role: "support" });

    const result = await resolveDeliveryZone("acme", "80000");

    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
