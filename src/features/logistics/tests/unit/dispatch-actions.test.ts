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
import {
  assignOrder,
  unassignOrder,
  departTruck,
  autoAssignOrder,
  applyPlan,
  setOrderLoaded,
} from "../../server/dispatch-actions";

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
      messageKey: "errors.logistics.dispatch.runDeparted",
    });
  });

  it("returns forbidden for warehouse-only roles", async () => {
    mockSupabaseFor({ role: "inventory" });

    const result = await assignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
    });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: expect.any(String),
    });
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

describe("autoAssignOrder", () => {
  it("returns assigned:false reason:manual without calling the RPC for a manually-assigned order", async () => {
    const supabase = mockSupabaseFor({
      role: "logistics",
      tableResults: {
        orders: {
          data: {
            id: "5b1f5c1e-0000-4000-8000-000000000001",
            postcode: "82000",
            delivery_date: "2026-08-14",
            slot_id: "5b1f5c1e-0000-4000-8000-000000000003",
            assignment_source: "manual",
            status: "confirmed",
          },
          error: null,
        },
      },
    });

    const result = await autoAssignOrder("ayam-norliza-pilot", "5b1f5c1e-0000-4000-8000-000000000001");

    expect(result).toEqual({ ok: true, data: { assigned: false, reason: "manual" } });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("departTruck", () => {
  it("errors when no run exists for the truck and date", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result).toEqual({
      ok: false,
      code: "not_found",
      message: "No delivery run exists for this truck on this date.",
      messageKey: "errors.logistics.dispatch.departNotFound",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_depart_truck", {
      p_truck: "5b1f5c1e-0000-4000-8000-000000000002",
      p_date: "2026-08-14",
    });
  });

  it("departs the run via dispatch_depart_truck", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_depart_truck", {
      p_truck: "5b1f5c1e-0000-4000-8000-000000000002",
      p_date: "2026-08-14",
    });
  });

  it("maps invalid_transition RPC error to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "invalid_transition" } });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "This run cannot depart from its current status.",
      messageKey: "errors.logistics.dispatch.departInvalidTransition",
    });
  });

  it("maps not_loaded RPC error to the shared driver-deck loading-gate copy", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "not_loaded" } });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "The truck is not fully loaded yet. The loading bay has to sign every stop off first.",
      messageKey: "errors.drive.run.notLoaded",
    });
  });
});

describe("applyPlan", () => {
  it("rejects a malformed payload with a validation error", async () => {
    mockSupabaseFor({ role: "logistics" });

    const result = await applyPlan("ayam-norliza-pilot", { assignments: [] });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, code: "validation" });
  });

  it("applies each assignment via dispatch_assign_order with p_source auto and counts failures per order", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "invalid_status" } });

    const result = await applyPlan("ayam-norliza-pilot", {
      assignments: [
        { orderId: "5b1f5c1e-0000-4000-8000-000000000001", truckId: "5b1f5c1e-0000-4000-8000-000000000002" },
        { orderId: "5b1f5c1e-0000-4000-8000-000000000003", truckId: "5b1f5c1e-0000-4000-8000-000000000004" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.data.applied).toBe(1);
    expect(result.data.failed).toHaveLength(1);
    expect(result.data.failed[0]?.orderId).toBe("5b1f5c1e-0000-4000-8000-000000000003");
    expect(result.data.failed[0]?.message).toContain("confirmed or ready");

    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "dispatch_assign_order", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000001",
      p_truck: "5b1f5c1e-0000-4000-8000-000000000002",
      p_source: "auto",
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "dispatch_assign_order", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000003",
      p_truck: "5b1f5c1e-0000-4000-8000-000000000004",
      p_source: "auto",
    });
  });
});

describe("setOrderLoaded", () => {
  it("calls dispatch_set_loaded with the parsed flags", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await setOrderLoaded("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      loaded: true,
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_set_loaded", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000001",
      p_loaded: true,
    });
  });

  it("maps run_departed rpc errors to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "run_departed" } });

    const result = await setOrderLoaded("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      loaded: false,
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "That run has already departed.",
      messageKey: "errors.logistics.dispatch.runDeparted",
    });
  });
});
