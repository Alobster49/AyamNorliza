/**
 * Unit tests for the market-price Server Actions. `setMarketState` shipped
 * with no authorization check at all and wrote to whatever org id the client
 * passed; these tests pin that every action runs through the dynamic-RBAC
 * `requirePermission` guard and writes only to the guard's own org.
 *
 * The Supabase server client is mocked, so no database is required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-permission", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OrderPermissionError } from "@/features/orders/server/guards";
import type { PermissionAction } from "@/lib/auth/rbac";
import { getMarketSuggestions, setMarketState } from "../../server/actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };
type Builder = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
};

function chain(result: QueryResult): Builder {
  const builder = {} as Builder;
  for (const method of ["select", "insert", "update", "upsert", "delete", "eq", "in", "gte", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

/** Grants per role, mirroring DEFAULT_ROLE_GRANTS in @/lib/auth/rbac. */
const GRANTS: Record<string, Partial<Record<string, PermissionAction[]>>> = {
  seller: { market_prices: ["view", "add", "edit", "delete"] },
  inventory: { warehouse_tasks: ["view", "edit"] },
};

const builders = new Map<string, Builder>();

function mockSupabaseFor({ role = "seller", orgId = "org-1" }: { role?: string; orgId?: string } = {}) {
  builders.clear();

  vi.mocked(requirePermission).mockImplementation(async (_slug, resource, action) => {
    const grants = GRANTS[role]?.[resource] ?? [];
    if (!grants.includes(action)) throw new OrderPermissionError();
    return { orgId, userId: "user-1", roleId: "role-1", roleKey: role, timeZone: "Asia/Kuala_Lumpur" };
  });

  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn((table: string) => {
      const existing = builders.get(table);
      if (existing) return existing;
      const builder = chain({ data: null, error: null });
      builders.set(table, builder);
      return builder;
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(requirePermission).mockReset();
});

describe("setMarketState", () => {
  it("rejects a caller without market_prices:edit", async () => {
    mockSupabaseFor({ role: "inventory" });

    await expect(setMarketState("ayam-norliza", "Johor")).rejects.toBeInstanceOf(OrderPermissionError);
  });

  it("writes the state to the org id resolved by the guard", async () => {
    mockSupabaseFor({ role: "seller", orgId: "org-1" });

    await setMarketState("ayam-norliza", "Johor");

    expect(builders.get("market_settings")?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: "org-1", states: ["Johor"] }),
    );
  });

  it("still rejects an unknown state before touching the database", async () => {
    mockSupabaseFor({ role: "seller" });

    await expect(setMarketState("ayam-norliza", "Atlantis")).rejects.toThrow(/state/i);
    expect(builders.has("market_settings")).toBe(false);
  });
});

describe("getMarketSuggestions", () => {
  it("rejects a caller without market_prices:view", async () => {
    mockSupabaseFor({ role: "inventory" });

    await expect(getMarketSuggestions("ayam-norliza")).rejects.toBeInstanceOf(OrderPermissionError);
  });

  it("passes the guard's org id to the suggestions RPC", async () => {
    const supabase = mockSupabaseFor({ role: "seller", orgId: "org-1" });

    await getMarketSuggestions("ayam-norliza");

    expect(supabase.rpc).toHaveBeenCalledWith("get_market_suggestions", {
      p_organization_id: "org-1",
    });
  });
});
