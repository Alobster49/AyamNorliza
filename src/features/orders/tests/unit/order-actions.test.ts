/**
 * Unit tests for manager/staff order Server Actions. The Supabase server
 * client is mocked; `requireOrgRole` (in ./guards) is exercised indirectly
 * through the actions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTodayTasks, confirmOrder, closeOrder } from "../../server/order-actions";
import { mapRpcError } from "../../lib/rpc-errors";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "or", "order", "is", "lte", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  role = "owner",
  tableResults = {} as Record<string, QueryResult>,
  rpcResult = { data: null, error: null } as { data: unknown; error: { message: string } | null },
}: {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  tableResults?: Record<string, QueryResult>;
  rpcResult?: { data: unknown; error: { message: string } | null };
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
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const ORDER_ID = "44444444-4444-4444-4444-444444444444";
const ITEM_ID = "55555555-5555-5555-5555-555555555555";

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getTodayTasks", () => {
  it("allows a staff role (logistics)", async () => {
    mockSupabaseFor({
      role: "logistics",
      tableResults: { order_tasks: { data: [], error: null } },
    });

    const result = await getTodayTasks("ayam-norliza-pilot");

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("forbids the support role", async () => {
    mockSupabaseFor({ role: "support" });

    const result = await getTodayTasks("ayam-norliza-pilot");

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });
});

describe("confirmOrder", () => {
  it("passes decisions through to the confirm_order rpc", async () => {
    const supabase = mockSupabaseFor({ role: "owner", rpcResult: { data: null, error: null } });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      decisions: [{ itemId: ITEM_ID, available: true }],
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(supabase.rpc).toHaveBeenCalledWith("confirm_order", {
      p_order: ORDER_ID,
      p_decisions: [{ item_id: ITEM_ID, available: true }],
    });
  });
});

describe("closeOrder", () => {
  it("returns the settlement total from the rpc", async () => {
    mockSupabaseFor({ role: "owner", rpcResult: { data: 245.5, error: null } });

    const result = await closeOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      lines: [{ itemId: ITEM_ID, finalWeightKg: 14.5, pricePerKg: 16.5 }],
    });

    expect(result).toEqual({ ok: true, data: { total: 245.5 } });
  });
});

describe("mapRpcError", () => {
  const cases: Array<[string, string]> = [
    ["slot_full", "conflict"],
    ["date_blocked", "conflict"],
    ["invalid_status", "conflict"],
    ["forbidden", "forbidden"],
    ["decisions_incomplete", "validation"],
    ["weights_incomplete", "validation"],
    ["lines_incomplete", "validation"],
    ["task_done", "conflict"],
    ["invalid_items", "validation"],
    ["zone_not_found", "not_found"],
    ["slot_not_found", "not_found"],
    ["date_out_of_window", "validation"],
    ["weekday_mismatch", "validation"],
    ["invalid_weight", "validation"],
    ["invalid_price", "validation"],
    ["invalid_transition", "conflict"],
    ["some_unrecognized_code", "internal"],
  ];

  it.each(cases)("maps %s to code %s", (message, expectedCode) => {
    const result = mapRpcError(message);
    expect(result.code).toBe(expectedCode);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
