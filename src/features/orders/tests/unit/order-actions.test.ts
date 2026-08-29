/**
 * Unit tests for manager/staff order Server Actions. The Supabase server
 * client is mocked; `requireOrgRole` (in ./guards) is exercised indirectly
 * through the actions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/features/logistics/server/dispatch-actions", () => ({
  autoAssignOrder: vi.fn().mockResolvedValue({ ok: true, data: { assigned: true } }),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { autoAssignOrder } from "@/features/logistics/server/dispatch-actions";
import {
  getTodayTasks,
  confirmOrder,
  closeOrder,
  getOrderDetail,
  createManualOrder,
  setRunStatus,
  completeTask,
  claimWeighTask,
} from "../../server/order-actions";
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

    expect(result).toEqual({ ok: true, data: { tasks: [], people: {} } });
  });

  it("forbids the support role", async () => {
    mockSupabaseFor({ role: "support" });

    const result = await getTodayTasks("ayam-norliza-pilot");

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.orders.permission.forbidden",
    });
  });

  it("resolves display names for whoever is claiming a weigh task", async () => {
    const CLAIMER_ID = "88888888-8888-8888-8888-888888888888";
    mockSupabaseFor({
      role: "logistics",
      tableResults: {
        order_tasks: {
          data: [
            {
              id: "task-1",
              organization_id: "org-1",
              order_id: ORDER_ID,
              type: "allocate_weigh",
              assigned_to: null,
              status: "pending",
              done_by: null,
              done_at: null,
              weigh_claimed_by: CLAIMER_ID,
              weigh_claimed_at: "2026-08-29T01:00:00.000Z",
              created_at: "2026-08-29T00:00:00.000Z",
              updated_at: "2026-08-29T00:00:00.000Z",
              version: 1,
            },
          ],
          error: null,
        },
        profiles: {
          data: [{ user_id: CLAIMER_ID, display_name: "Aiman" }],
          error: null,
        },
      },
    });

    const result = await getTodayTasks("ayam-norliza-pilot");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.people).toEqual({ [CLAIMER_ID]: "Aiman" });
    }
  });
});

describe("claimWeighTask", () => {
  const TASK_ID = "11111111-1111-4111-8111-111111111111";

  it("calls claim_weigh_task and returns ok", async () => {
    const supabase = mockSupabaseFor({ role: "logistics", rpcResult: { data: null, error: null } });

    const result = await claimWeighTask({
      organizationSlug: "ayam-norliza-pilot",
      taskId: TASK_ID,
      claim: true,
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_weigh_task", { p_task: TASK_ID, p_claim: true });
  });

  it("maps claimed_by_other to a conflict with the tasks messageKey", async () => {
    mockSupabaseFor({
      role: "logistics",
      rpcResult: { data: null, error: { message: "claimed_by_other" } },
    });

    const result = await claimWeighTask({
      organizationSlug: "ayam-norliza-pilot",
      taskId: TASK_ID,
      claim: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.messageKey).toBe("errors.orders.tasks.claimedByOther");
    }
  });

  it("rejects invalid input", async () => {
    const result = await claimWeighTask({
      organizationSlug: "ayam-norliza-pilot",
      taskId: "nope",
      claim: true,
    });

    expect(result.ok).toBe(false);
  });
});

describe("completeTask claim conflict", () => {
  it("maps claimed_by_other with the tasks messageKey", async () => {
    mockSupabaseFor({
      role: "logistics",
      rpcResult: { data: null, error: { message: "claimed_by_other" } },
    });

    const result = await completeTask({
      organizationSlug: "ayam-norliza-pilot",
      taskId: "11111111-1111-4111-8111-111111111111",
      weights: [{ itemId: ITEM_ID, weightKg: 1.5 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.messageKey).toBe("errors.orders.tasks.claimedByOther");
    }
  });
});

describe("confirmOrder", () => {
  it("passes decisions through to the confirm_order rpc", async () => {
    const supabase = mockSupabaseFor({ role: "owner", rpcResult: { data: null, error: null } });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      decisions: [{ itemId: ITEM_ID, available: true, pricePerKg: 11.5 }],
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(supabase.rpc).toHaveBeenCalledWith("confirm_order", {
      p_order: ORDER_ID,
      p_decisions: [{ item_id: ITEM_ID, available: true, price_per_kg: 11.5 }],
    });
  });
});

describe("setRunStatus", () => {
  const RUN_ID = "66666666-6666-6666-6666-666666666666";

  it("departs the run via set_run_status", async () => {
    const supabase = mockSupabaseFor({ role: "owner", rpcResult: { data: null, error: null } });

    const result = await setRunStatus("ayam-norliza-pilot", RUN_ID, "departed");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(supabase.rpc).toHaveBeenCalledWith("set_run_status", { p_run: RUN_ID, p_status: "departed" });
  });

  it("maps not_loaded to the shared driver-deck loading-gate copy", async () => {
    const supabase = mockSupabaseFor({
      role: "owner",
      rpcResult: { data: null, error: { message: "not_loaded" } },
    });

    const result = await setRunStatus("ayam-norliza-pilot", RUN_ID, "departed");

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "The truck is not fully loaded yet. The loading bay has to sign every stop off first.",
      messageKey: "errors.drive.run.notLoaded",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("set_run_status", { p_run: RUN_ID, p_status: "departed" });
  });
});

describe("confirmOrder auto-assign", () => {
  it("fires autoAssignOrder after a successful confirm", async () => {
    mockSupabaseFor({ role: "seller", rpcResult: { data: null, error: null } });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      decisions: [{ itemId: ITEM_ID, available: true }],
    });

    expect(result.ok).toBe(true);
    expect(autoAssignOrder).toHaveBeenCalledWith("ayam-norliza-pilot", ORDER_ID);
  });

  it("does not fail the confirm when auto-assign errors", async () => {
    vi.mocked(autoAssignOrder).mockResolvedValueOnce({
      ok: false,
      code: "internal",
      message: "boom",
    });
    mockSupabaseFor({ role: "seller", rpcResult: { data: null, error: null } });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      decisions: [{ itemId: ITEM_ID, available: true }],
    });

    expect(result.ok).toBe(true);
  });

  it("does not fail the confirm when auto-assign throws", async () => {
    vi.mocked(autoAssignOrder).mockRejectedValueOnce(new Error("boom"));
    mockSupabaseFor({ role: "seller", rpcResult: { data: null, error: null } });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: ORDER_ID,
      decisions: [{ itemId: ITEM_ID, available: true }],
    });

    expect(result.ok).toBe(true);
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

describe("createManualOrder", () => {
  const CUSTOMER_ID = "77777777-7777-7777-7777-777777777777";
  const ZONE_ID = "11111111-1111-1111-1111-111111111111";
  const SLOT_ID = "22222222-2222-2222-2222-222222222222";
  const PRODUCT_ID = "33333333-3333-3333-3333-333333333333";

  const validInput = {
    organizationSlug: "ayam-norliza-pilot",
    customerId: CUSTOMER_ID,
    zoneId: ZONE_ID,
    slotId: SLOT_ID,
    deliveryDate: "2026-08-15",
    address: "123 Jalan Ayam",
    items: [
      {
        productId: PRODUCT_ID,
        mode: "kg" as const,
        quantity: 2,
        sizeMinKg: 1.5,
        sizeMaxKg: 1.7,
        fallback: "mix" as const,
      },
    ],
  };

  it("passes the postcode through to the place_order rpc as p_postcode", async () => {
    const supabase = mockSupabaseFor({
      role: "owner",
      rpcResult: { data: ORDER_ID, error: null },
    });

    await createManualOrder({ ...validInput, postcode: "82000" });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "place_order",
      expect.objectContaining({ p_postcode: "82000" }),
    );
  });

  it("sends p_postcode: null when no postcode is given", async () => {
    const supabase = mockSupabaseFor({
      role: "owner",
      rpcResult: { data: ORDER_ID, error: null },
    });

    await createManualOrder(validInput);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "place_order",
      expect.objectContaining({ p_postcode: null }),
    );
  });
});

describe("getOrderDetail", () => {
  it("queries order_weight_log scoped to the order's items/org and attaches it as weight_log", async () => {
    const WEIGHT_LOG_ROW = {
      id: "66666666-6666-6666-6666-666666666666",
      organization_id: "org-1",
      order_item_id: ITEM_ID,
      kind: "final",
      weight_kg: 3.2,
      pieces: 2,
      recorded_by: "user-1",
      recorded_at: "2026-08-10T12:00:00.000Z",
    };

    const supabase = mockSupabaseFor({
      role: "owner",
      tableResults: {
        orders: { data: { id: ORDER_ID, organization_id: "org-1" }, error: null },
        order_items: { data: [{ id: ITEM_ID }], error: null },
        order_tasks: { data: [], error: null },
        order_weight_log: { data: [WEIGHT_LOG_ROW], error: null },
      },
    });

    const result = await getOrderDetail("ayam-norliza-pilot", ORDER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.weight_log).toEqual([WEIGHT_LOG_ROW]);
    }
    expect(supabase.from).toHaveBeenCalledWith("order_weight_log");
  });

  it("skips the order_weight_log query and returns an empty array when the order has no items", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        orders: { data: { id: ORDER_ID, organization_id: "org-1" }, error: null },
        order_items: { data: [], error: null },
        order_tasks: { data: [], error: null },
      },
    });

    const result = await getOrderDetail("ayam-norliza-pilot", ORDER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.weight_log).toEqual([]);
    }
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
    ["claimed_by_other", "conflict"],
    ["some_unrecognized_code", "internal"],
  ];

  it.each(cases)("maps %s to code %s", (message, expectedCode) => {
    const result = mapRpcError(message);
    expect(result.code).toBe(expectedCode);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
