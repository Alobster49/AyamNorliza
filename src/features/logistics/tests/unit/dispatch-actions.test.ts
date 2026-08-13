/**
 * Unit tests for dispatch Server Actions. The Supabase server client is
 * mocked so no database is required; `requireOrgRole` (in
 * @/features/orders/server/guards) is exercised indirectly through the
 * actions since it has no dedicated test file of its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignOrder, unassignOrder, departTruck } from "../../server/dispatch-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A minimal chainable Supabase query-builder stub. Every builder method
 * (select/insert/update/delete/eq/...) returns the same object so calls
 * can be chained in any order; `.single()`/`.maybeSingle()` resolve the
 * configured result, and the object is itself thenable so code that
 * `await`s the builder directly (no terminal call, e.g. a bare `.delete()`)
 * also resolves the configured result.
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
 * Builds a mock Supabase client. `from("organizations")` and
 * `from("organization_members")` are wired to satisfy `requireOrgRole`;
 * any other table name is served from `tableResults`, falling back to
 * `{ data: null, error: null }`.
 */
function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  role = "owner",
  tableResults = {} as Record<string, QueryResult>,
}: {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  tableResults?: Record<string, QueryResult>;
}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return chain({ data: orgId ? { id: orgId } : null, error: null });
      }
      if (table === "organization_members") {
        return chain({ data: role ? { role } : null, error: null });
      }
      if (tableResults[table]) {
        return chain(tableResults[table]);
      }
      return chain({ data: null, error: null });
    }),
    rpc: vi.fn(),
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

describe("assignOrder", () => {
  it("allows logistics staff and calls the RPC with source manual", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await assignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_assign_order", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000001",
      p_truck: "5b1f5c1e-0000-4000-8000-000000000002",
      p_source: "manual",
    });
  });

  it("maps run_departed RPC error to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "owner" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "run_departed" } });

    const result = await assignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "That run has already departed.",
    });
  });

  it("returns forbidden for warehouse-only roles", async () => {
    mockSupabaseFor({ role: "inventory" });

    const result = await assignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
    });

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });
});

describe("unassignOrder", () => {
  it("calls the unassign RPC", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await unassignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_unassign_order", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000001",
    });
  });
});

describe("departTruck", () => {
  it("errors when no run exists for the truck and date", async () => {
    const supabase = mockSupabaseFor({
      role: "logistics",
      tableResults: { delivery_runs: { data: null, error: null } },
    });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result).toEqual({
      ok: false,
      code: "not_found",
      message: "No delivery run exists for this truck on this date.",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("departs the run via set_run_status", async () => {
    const supabase = mockSupabaseFor({
      role: "logistics",
      tableResults: { delivery_runs: { data: { id: "run-1" }, error: null } },
    });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("set_run_status", {
      p_run: "run-1",
      p_status: "departed",
    });
  });
});
