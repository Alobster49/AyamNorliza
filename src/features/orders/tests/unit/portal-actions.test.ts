/**
 * Unit tests for buyer-portal Server Actions. Both the Supabase server
 * client and the buyer-auth guard are mocked so no database/session is
 * required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/auth/buyer-auth", () => ({
  requireBuyer: vi.fn(),
  NotABuyerError: class NotABuyerError extends Error {
    readonly code = "not_a_buyer";
  },
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import { placeOrder, cancelMyOrder } from "../../server/portal-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

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

function mockSupabase({
  orgId = "org-1",
  rpcResult = { data: null, error: null } as { data: unknown; error: { message: string } | null },
}: {
  orgId?: string | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
} = {}) {
  const supabase = {
    from: vi.fn(() => chain({ data: orgId ? { id: orgId } : null, error: null })),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const testBuyer = {
  id: "buyer-1",
  organization_id: "org-1",
  display_name: "Test Buyer",
  address: null,
  phone: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

const validPlaceOrderInput = {
  organizationSlug: "ayam-norliza-pilot",
  zoneId: "11111111-1111-1111-1111-111111111111",
  slotId: "22222222-2222-2222-2222-222222222222",
  deliveryDate: "2026-08-15",
  address: "123 Jalan Ayam",
  items: [
    {
      productId: "33333333-3333-3333-3333-333333333333",
      mode: "kg" as const,
      quantity: 2,
      sizeMinKg: 1.5,
      sizeMaxKg: 1.7,
      fallback: "mix" as const,
    },
  ],
};

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(requireBuyer).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("placeOrder", () => {
  it("places an order and returns the new order id", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: "order-1", error: null } });

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({ ok: true, data: { orderId: "order-1" } });
  });

  it("passes the postcode through to the place_order rpc as p_postcode", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    const supabase = mockSupabase({ rpcResult: { data: "order-1", error: null } });

    await placeOrder({ ...validPlaceOrderInput, postcode: "82000" });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "place_order",
      expect.objectContaining({ p_postcode: "82000" }),
    );
  });

  it("sends p_postcode: null when no postcode is given", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    const supabase = mockSupabase({ rpcResult: { data: "order-1", error: null } });

    await placeOrder(validPlaceOrderInput);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "place_order",
      expect.objectContaining({ p_postcode: null }),
    );
  });

  it("maps slot_full to the errors.buyer.order.slotFull key", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "slot_full" } } });

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      messageKey: "errors.buyer.order.slotFull",
    });
  });

  it("returns the unauthenticated key when the caller is not a buyer", async () => {
    vi.mocked(requireBuyer).mockRejectedValue(new NotABuyerError("Not registered as a buyer"));

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({
      ok: false,
      code: "unauthenticated",
      messageKey: "errors.buyer.order.unauthenticated",
    });
  });

  it("maps invalid order input to the errors.buyer.order.invalidInput key, with fieldErrors", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);

    const result = await placeOrder({ ...validPlaceOrderInput, zoneId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.order.invalidInput");
      expect(result.fieldErrors).toBeDefined();
    }
  });

  it("rejects a customerId on portal orders with the customerIdNotAllowed key", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);

    const result = await placeOrder({ ...validPlaceOrderInput, customerId: "44444444-4444-4444-4444-444444444444" });

    expect(result).toEqual({
      ok: false,
      code: "validation",
      messageKey: "errors.buyer.order.customerIdNotAllowed",
    });
  });

  it("maps a missing organization to the errors.buyer.order.orgNotFound key", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ orgId: null });

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({
      ok: false,
      code: "not_found",
      messageKey: "errors.buyer.order.orgNotFound",
    });
  });
});

describe("cancelMyOrder", () => {
  it("maps invalid_status to the errors.buyer.order.invalidStatus key", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "invalid_status" } } });

    const result = await cancelMyOrder("order-1", "Changed my mind");

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      messageKey: "errors.buyer.order.invalidStatus",
    });
  });

  it("returns the unauthenticated key when the caller is not a buyer", async () => {
    vi.mocked(requireBuyer).mockRejectedValue(new NotABuyerError("Not registered as a buyer"));

    const result = await cancelMyOrder("order-1");

    expect(result).toEqual({
      ok: false,
      code: "unauthenticated",
      messageKey: "errors.buyer.order.unauthenticated",
    });
  });

  it("maps forbidden to the errors.buyer.order.forbidden key", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "forbidden" } } });

    const result = await cancelMyOrder("order-1");

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      messageKey: "errors.buyer.order.forbidden",
    });
  });

  it("maps an unrecognized RPC error to the errors.buyer.order.internal key", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "some_unknown_code" } } });

    const result = await cancelMyOrder("order-1");

    expect(result).toEqual({
      ok: false,
      code: "internal",
      messageKey: "errors.buyer.order.internal",
    });
  });
});
