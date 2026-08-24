/**
 * Key-assertion tests for the `errors.orders.*` messageKeys added to
 * `src/features/orders/server/order-actions.ts` (Phase 3 seller clean-file
 * batch, Task 6). Covers only the actions consumed by the converted seller
 * screens (order-detail-client.tsx, new-order-client.tsx, board-dialogs.tsx,
 * orders-board.tsx): getOrderDetail, createManualOrder, confirmOrder,
 * cancelOrder, closeOrder, reopenOrder, getDeliveryOptionsForOrg,
 * resolveDeliveryZone. Every other action in the file stays prose-only
 * (`message`), consumed by the still-dirty swipe-deck.tsx /
 * weigh-station.tsx / runs-client.tsx.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../../server/guards", async () => {
  const actual = await vi.importActual<typeof import("../../server/guards")>("../../server/guards");
  return {
    OrderPermissionError: actual.OrderPermissionError,
    requireOrgRole: vi.fn(),
  };
});

vi.mock("@/features/logistics/server/dispatch-actions", () => ({
  autoAssignOrder: vi.fn().mockResolvedValue(undefined),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "../../server/guards";
import {
  getOrderDetail,
  createManualOrder,
  confirmOrder,
  cancelOrder,
  closeOrder,
  reopenOrder,
  getDeliveryOptionsForOrg,
  resolveDeliveryZone,
} from "../../server/order-actions";

function mockGuard() {
  vi.mocked(requireOrgRole).mockResolvedValue({
    orgId: "org-1",
    userId: "user-1",
    role: "owner",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "single"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabaseFrom(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const supabase = { from: vi.fn(() => chain(result)) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

function mockSupabaseRpc(rpcResult: { data?: unknown; error: { message: string } | null }) {
  const supabase = { rpc: vi.fn(() => Promise.resolve(rpcResult)) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const validItem = {
  productId: "11111111-1111-1111-1111-111111111111",
  mode: "piece" as const,
  quantity: 1,
  sizeMinKg: 1,
  sizeMaxKg: 2,
  fallback: "mix" as const,
};

const validCreateInput = {
  organizationSlug: "ayam-norliza-pilot",
  zoneId: "22222222-2222-2222-2222-222222222222",
  slotId: "33333333-3333-3333-3333-333333333333",
  deliveryDate: "2026-09-01",
  address: "1 Jalan Ayam",
  customerId: "44444444-4444-4444-4444-444444444444",
  items: [validItem],
};

const validConfirmInput = {
  organizationSlug: "ayam-norliza-pilot",
  orderId: "55555555-5555-5555-5555-555555555555",
  decisions: [{ itemId: "11111111-1111-1111-1111-111111111111", available: true }],
};

const validCloseInput = {
  organizationSlug: "ayam-norliza-pilot",
  orderId: "55555555-5555-5555-5555-555555555555",
  lines: [
    {
      itemId: "11111111-1111-1111-1111-111111111111",
      finalWeightKg: 1.5,
      pricePerKg: 12,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guardRoles permission (via getOrderDetail)", () => {
  it("returns errors.orders.permission.unauthenticated", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError("Not authenticated"));
    const result = await getOrderDetail("ayam-norliza-pilot", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.permission.unauthenticated");
  });

  it("returns errors.orders.permission.orgNotFound", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError("Organization not found"));
    const result = await getOrderDetail("no-such-org", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.permission.orgNotFound");
  });

  it("returns errors.orders.permission.forbidden for the generic case", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError());
    const result = await getOrderDetail("ayam-norliza-pilot", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.permission.forbidden");
  });
});

describe("getOrderDetail", () => {
  it("returns errors.orders.detail.notFound when the order query misses", async () => {
    mockGuard();
    mockSupabaseFrom({ data: null, error: { message: "no rows" } });
    const result = await getOrderDetail("ayam-norliza-pilot", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.detail.notFound");
  });
});

describe("createManualOrder", () => {
  it("returns errors.orders.create.invalidInput for a schema failure", async () => {
    const result = await createManualOrder({ ...validCreateInput, zoneId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.create.invalidInput");
  });

  it("returns errors.orders.create.customerRequired when customerId is missing", async () => {
    const { customerId: _customerId, ...withoutCustomer } = validCreateInput;
    const result = await createManualOrder(withoutCustomer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.create.customerRequired");
  });

  it.each([
    ["zone_not_found", "errors.orders.create.zoneNotFound"],
    ["slot_not_found", "errors.orders.create.slotNotFound"],
    ["date_out_of_window", "errors.orders.create.dateOutOfWindow"],
    ["weekday_mismatch", "errors.orders.create.weekdayMismatch"],
    ["date_blocked", "errors.orders.create.dateBlocked"],
    ["slot_full", "errors.orders.create.slotFull"],
    ["invalid_items", "errors.orders.create.invalidItems"],
    ["forbidden", "errors.orders.create.forbidden"],
    ["some_unmapped_code", "errors.orders.create.internal"],
  ])("maps RPC message %s to %s", async (rpcMessage, expectedKey) => {
    mockGuard();
    mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await createManualOrder(validCreateInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe(expectedKey);
  });
});

describe("confirmOrder", () => {
  it("returns errors.orders.confirm.invalidInput for a schema failure", async () => {
    const result = await confirmOrder({ ...validConfirmInput, decisions: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.confirm.invalidInput");
  });

  it.each([
    ["forbidden", "errors.orders.confirm.forbidden"],
    ["invalid_status", "errors.orders.confirm.invalidStatus"],
    ["decisions_incomplete", "errors.orders.confirm.decisionsIncomplete"],
    ["some_unmapped_code", "errors.orders.confirm.internal"],
  ])("maps RPC message %s to %s", async (rpcMessage, expectedKey) => {
    mockGuard();
    mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await confirmOrder(validConfirmInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe(expectedKey);
  });
});

describe("cancelOrder", () => {
  it.each([
    ["forbidden", "errors.orders.cancel.forbidden"],
    ["invalid_status", "errors.orders.cancel.invalidStatus"],
    ["some_unmapped_code", "errors.orders.cancel.internal"],
  ])("maps RPC message %s to %s", async (rpcMessage, expectedKey) => {
    mockGuard();
    mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await cancelOrder("ayam-norliza-pilot", "order-1", "changed mind");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe(expectedKey);
  });
});

describe("closeOrder", () => {
  it("returns errors.orders.close.invalidInput for a schema failure", async () => {
    const result = await closeOrder({ ...validCloseInput, lines: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.close.invalidInput");
  });

  it.each([
    ["forbidden", "errors.orders.close.forbidden"],
    ["invalid_status", "errors.orders.close.invalidStatus"],
    ["lines_incomplete", "errors.orders.close.linesIncomplete"],
    ["invalid_weight", "errors.orders.close.invalidWeight"],
    ["invalid_price", "errors.orders.close.invalidPrice"],
    ["some_unmapped_code", "errors.orders.close.internal"],
  ])("maps RPC message %s to %s", async (rpcMessage, expectedKey) => {
    mockGuard();
    mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await closeOrder(validCloseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe(expectedKey);
  });
});

describe("reopenOrder", () => {
  it.each([
    ["forbidden", "errors.orders.reopen.forbidden"],
    ["invalid_status", "errors.orders.reopen.invalidStatus"],
    ["some_unmapped_code", "errors.orders.reopen.internal"],
  ])("maps RPC message %s to %s", async (rpcMessage, expectedKey) => {
    mockGuard();
    mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await reopenOrder("ayam-norliza-pilot", "order-1", "reopen reason");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe(expectedKey);
  });
});

describe("getDeliveryOptionsForOrg", () => {
  it("returns errors.orders.delivery.optionsLoadFailed when the RPC errors", async () => {
    mockGuard();
    mockSupabaseRpc({ error: { message: "db down" } });
    const result = await getDeliveryOptionsForOrg("ayam-norliza-pilot", "zone-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.delivery.optionsLoadFailed");
  });
});

describe("resolveDeliveryZone", () => {
  it("returns errors.orders.delivery.invalidPostcode for a malformed postcode", async () => {
    mockGuard();
    const result = await resolveDeliveryZone("ayam-norliza-pilot", "abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.delivery.invalidPostcode");
  });

  it("returns errors.orders.delivery.coverageCheckFailed when the RPC errors", async () => {
    mockGuard();
    mockSupabaseRpc({ error: { message: "db down" } });
    const result = await resolveDeliveryZone("ayam-norliza-pilot", "43000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.orders.delivery.coverageCheckFailed");
  });
});
