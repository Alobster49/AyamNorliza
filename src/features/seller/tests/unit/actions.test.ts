/**
 * Unit tests for the seller catalog/customer Server Actions. These actions
 * shipped without any authorization guard and trusted a client-supplied
 * organization id, so the tests below pin the two properties that fix
 * requires: every action goes through the dynamic-RBAC `requirePermission`
 * guard, and every mutation is scoped to the org id the guard returned
 * (never one the caller passed in).
 *
 * The Supabase server client is mocked, so no database is required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-permission", () => ({
  requirePermission: vi.fn(),
  requireAnyPermission: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyPermission, requirePermission } from "@/lib/auth/require-permission";
import { OrderPermissionError } from "@/features/orders/server/guards";
import type { PermissionAction } from "@/lib/auth/rbac";
import {
  createCategory,
  deleteCustomer,
  deleteProduct,
  getCatalogForOrdering,
  searchCustomers,
  updateProduct,
} from "../../server/actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

type Builder = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
};

/**
 * Minimal chainable Supabase query-builder stub: every builder method
 * returns the same object so calls chain in any order, `.single()`/
 * `.maybeSingle()` resolve the configured result, and the object is itself
 * thenable so an awaited builder with no terminal call also resolves.
 */
function chain(result: QueryResult): Builder {
  const builder = {} as Builder;
  for (const method of ["select", "insert", "update", "upsert", "delete", "eq", "in", "or", "order", "is", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

/** Grants per role, mirroring DEFAULT_ROLE_GRANTS in @/lib/auth/rbac. */
const GRANTS: Record<string, Partial<Record<string, PermissionAction[]>>> = {
  owner: { products: ["view", "add", "edit", "delete"], customers: ["view", "add", "edit", "delete"] },
  seller: { products: ["view", "add", "edit", "delete"], customers: ["view", "add", "edit", "delete"] },
  inventory: { warehouse_tasks: ["view", "edit"] },
  /** A custom role that may take orders but was never given the catalog pages. */
  order_taker: { orders: ["view", "add"] },
};

const builders = new Map<string, Builder>();

function mockSupabaseFor({
  role = "seller",
  orgId = "org-1",
  userId = "user-1",
  tableResults = {} as Record<string, QueryResult>,
}: {
  role?: string | null;
  orgId?: string;
  userId?: string;
  tableResults?: Record<string, QueryResult>;
} = {}) {
  builders.clear();

  const context = { orgId, userId, roleId: "role-1", roleKey: role!, timeZone: "Asia/Kuala_Lumpur" };
  const holds = (resource: string, action: PermissionAction) =>
    ((role && GRANTS[role]?.[resource]) || []).includes(action);

  vi.mocked(requirePermission).mockImplementation(async (_slug, resource, action) => {
    if (!holds(resource, action)) throw new OrderPermissionError();
    return context;
  });
  vi.mocked(requireAnyPermission).mockImplementation(async (_slug, pairs) => {
    if (!pairs.some(([resource, action]) => holds(resource, action))) {
      throw new OrderPermissionError();
    }
    return context;
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    from: vi.fn((table: string) => {
      const existing = builders.get(table);
      if (existing) return existing;
      const builder = chain(tableResults[table] ?? { data: { id: "row-1" }, error: null });
      builders.set(table, builder);
      return builder;
    }),
    rpc: vi.fn(),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

/** Every `.eq(column, value)` pair recorded on the builder for `table`. */
function eqCalls(table: string): Array<[string, unknown]> {
  return (builders.get(table)?.eq?.mock.calls ?? []) as Array<[string, unknown]>;
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(requirePermission).mockReset();
  vi.mocked(requireAnyPermission).mockReset();
});

describe("seller catalog actions", () => {
  it("rejects a product update from a role without products:edit", async () => {
    mockSupabaseFor({ role: "inventory" });

    await expect(updateProduct("ayam-norliza", "prod-9", { name: "x" })).rejects.toBeInstanceOf(
      OrderPermissionError,
    );
  });

  it("scopes a product update to the org id resolved by the guard", async () => {
    mockSupabaseFor({ role: "seller", orgId: "org-1" });

    await updateProduct("ayam-norliza", "prod-9", { name: "Ayam Segar" });

    expect(eqCalls("products")).toEqual(
      expect.arrayContaining([
        ["id", "prod-9"],
        ["organization_id", "org-1"],
      ]),
    );
  });

  it("scopes a product delete to the caller's org", async () => {
    mockSupabaseFor({ role: "seller", orgId: "org-1", tableResults: { products: { data: null, error: null } } });

    await deleteProduct("ayam-norliza", "prod-9");

    expect(eqCalls("products")).toEqual(
      expect.arrayContaining([
        ["id", "prod-9"],
        ["organization_id", "org-1"],
      ]),
    );
  });

  it("lets a role that can take orders read the ordering catalog without a products:view grant", async () => {
    mockSupabaseFor({ role: "order_taker", tableResults: { categories: { data: [], error: null } } });

    await expect(getCatalogForOrdering("ayam-norliza")).resolves.toEqual([]);
  });

  it("still refuses the ordering catalog to a role with neither products:view nor orders:add", async () => {
    mockSupabaseFor({ role: "inventory" });

    await expect(getCatalogForOrdering("ayam-norliza")).rejects.toBeInstanceOf(OrderPermissionError);
  });

  it("creates a category in the guard's org rather than one supplied by the caller", async () => {
    mockSupabaseFor({ role: "seller", orgId: "org-1" });

    await createCategory("ayam-norliza", { name: "Whole birds", is_active: true });

    expect(builders.get("categories")?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-1", name: "Whole birds" }),
    );
  });
});

describe("seller customer actions", () => {
  it("rejects a customer delete from a role without customers:delete", async () => {
    mockSupabaseFor({ role: "inventory" });

    await expect(deleteCustomer("ayam-norliza", "cust-3")).rejects.toBeInstanceOf(OrderPermissionError);
  });

  it("scopes a customer delete to the caller's org", async () => {
    mockSupabaseFor({ role: "seller", orgId: "org-1", tableResults: { customers: { data: null, error: null } } });

    await deleteCustomer("ayam-norliza", "cust-3");

    expect(eqCalls("customers")).toEqual(
      expect.arrayContaining([
        ["id", "cust-3"],
        ["organization_id", "org-1"],
      ]),
    );
  });

  it("requires customers:view to search, matching what the customers RLS policy allows", async () => {
    // Widening this to `orders:add` would only turn a clear refusal into a
    // silently empty list: `customers_select` requires the view grant since
    // 20260901000006.
    mockSupabaseFor({ role: "order_taker" });

    await expect(searchCustomers("ayam-norliza", "ali")).rejects.toBeInstanceOf(
      OrderPermissionError,
    );
  });

  it("quotes search input so it cannot break out of the PostgREST or() filter", async () => {
    mockSupabaseFor({ role: "seller", tableResults: { customers: { data: [], error: null } } });

    await searchCustomers("ayam-norliza", 'ali,phone.gt."0');

    const filter = builders.get("customers")?.or?.mock.calls[0]?.[0] as string;
    // The raw input contains an or()-separator comma and a filter-terminating
    // quote; both must end up inside a quoted value, not as filter syntax.
    expect(filter).toBe('name.ilike."%ali,phone.gt.\\"0%",phone.ilike."%ali,phone.gt.\\"0%"');
  });
});
