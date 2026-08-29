/**
 * Unit tests for dispatch Server Actions. The Supabase server client is
 * mocked so no database is required; the dynamic-RBAC `requirePermission`/
 * `requireAnyPermission` guards (in @/lib/auth/require-permission) are
 * mocked directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-permission", () => ({
  requirePermission: vi.fn(),
  requireAnyPermission: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission, requireAnyPermission } from "@/lib/auth/require-permission";
import { OrderPermissionError } from "@/features/orders/server/guards";
import type { PermissionAction } from "@/lib/auth/rbac";
import {
  assignOrder,
  unassignOrder,
  departTruck,
  autoAssignOrder,
  applyPlan,
  setOrderLoaded,
  setLoadingClaim,
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
 * Grants each role holds on `dispatch`/`loading`, mirroring
 * DEFAULT_ROLE_GRANTS in the dynamic-RBAC schema migration: owner/org_admin
 * get full CRUD on both; seller/supervisor get `dispatch` CRUD plus a
 * `loading:edit`-only grant; inventory ("Worker") gets `loading` view+edit
 * only; driver and hr get neither.
 */
const GRANTS: Record<string, Partial<Record<string, PermissionAction[]>>> = {
  owner: { dispatch: ["view", "add", "edit", "delete"], loading: ["view", "add", "edit", "delete"] },
  org_admin: { dispatch: ["view", "add", "edit", "delete"], loading: ["view", "add", "edit", "delete"] },
  seller: { dispatch: ["view", "add", "edit", "delete"], loading: ["edit"] },
  supervisor: { dispatch: ["view", "add", "edit", "delete"], loading: ["edit"] },
  inventory: { loading: ["view", "edit"] },
  driver: {},
  hr: {},
};

function hasGrant(role: string | null, resource: string, action: PermissionAction): boolean {
  if (!role) return false;
  return (GRANTS[role]?.[resource] ?? []).includes(action);
}

/**
 * Builds a mock Supabase client and wires the mocked `requirePermission`/
 * `requireAnyPermission` guards to grant/deny based on `role`; any table
 * name is served from `tableResults`, falling back to
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
  vi.mocked(requirePermission).mockImplementation(async (_slug, resource, action) => {
    if (!userId || !orgId || !hasGrant(role, resource, action)) throw new OrderPermissionError();
    return { orgId, userId, roleId: "role-1", roleKey: role!, timeZone: "Asia/Kuala_Lumpur" };
  });
  vi.mocked(requireAnyPermission).mockImplementation(async (_slug, pairs) => {
    if (!userId || !orgId || !pairs.some(([r, a]) => hasGrant(role, r, a))) throw new OrderPermissionError();
    return { orgId, userId, roleId: "role-1", roleKey: role!, timeZone: "Asia/Kuala_Lumpur" };
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
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
  it("allows dispatch-role staff and calls the RPC with source manual", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
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
      role: "seller",
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
    const supabase = mockSupabaseFor({ role: "seller" });
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
    const supabase = mockSupabaseFor({ role: "seller" });
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
    const supabase = mockSupabaseFor({ role: "seller" });
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
    const supabase = mockSupabaseFor({ role: "seller" });
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
    mockSupabaseFor({ role: "seller" });

    const result = await applyPlan("ayam-norliza-pilot", { assignments: [] });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, code: "validation" });
  });

  it("applies each assignment via dispatch_assign_order with p_source auto and counts failures per order", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
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
    const supabase = mockSupabaseFor({ role: "seller" });
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

  it("maps not_weighed rpc errors to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "not_weighed" } });

    const result = await setOrderLoaded("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      loaded: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "That order has not been weighed yet — weigh it before loading.",
      messageKey: "errors.logistics.dispatch.notWeighed",
    });
  });

  it("maps run_departed rpc errors to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
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

describe("setOrderLoaded concurrency guards", () => {
  it("maps already_loaded rpc errors to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "already_loaded" } });

    const result = await setOrderLoaded("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      loaded: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "That order is already on the truck — someone else loaded it.",
      messageKey: "errors.logistics.dispatch.alreadyLoaded",
    });
  });

  it("maps claimed_by_other rpc errors to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "claimed_by_other" } });

    const result = await setOrderLoaded("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      loaded: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "Another worker is loading that order right now.",
      messageKey: "errors.logistics.dispatch.claimedByOther",
    });
  });
});

describe("setLoadingClaim", () => {
  it("calls dispatch_claim_loading with the claim flag", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await setLoadingClaim("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      claim: true,
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_claim_loading", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000001",
      p_claim: true,
    });
  });

  it("rejects invalid input", async () => {
    mockSupabaseFor({ role: "seller" });

    const result = await setLoadingClaim("ayam-norliza-pilot", { orderId: "nope", claim: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation");
  });

  it("maps claimed_by_other rpc errors to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "claimed_by_other" } });

    const result = await setLoadingClaim("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      claim: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "Another worker is loading that order right now.",
      messageKey: "errors.logistics.dispatch.claimedByOther",
    });
  });

  it("refuses viewers without a loading role", async () => {
    // Workers ("inventory") may claim on the loading screen (a `loading`
    // grant), so the forbidden case is a role with neither `dispatch` nor
    // `loading` permissions.
    mockSupabaseFor({ role: "hr" });

    const result = await setLoadingClaim("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      claim: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});
