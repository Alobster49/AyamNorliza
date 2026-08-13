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

  it("maps slot_full to a friendly conflict message", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "slot_full" } } });

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "That delivery slot just filled up — pick another.",
    });
  });

  it("returns unauthenticated when the caller is not a buyer", async () => {
    vi.mocked(requireBuyer).mockRejectedValue(new NotABuyerError("Not registered as a buyer"));

    const result = await placeOrder(validPlaceOrderInput);

    expect(result).toEqual({
      ok: false,
      code: "unauthenticated",
      message: "Not registered as a buyer",
    });
  });
});

describe("cancelMyOrder", () => {
  it("maps invalid_status to a friendly conflict message", async () => {
    vi.mocked(requireBuyer).mockResolvedValue(testBuyer);
    mockSupabase({ rpcResult: { data: null, error: { message: "invalid_status" } } });

    const result = await cancelMyOrder("order-1", "Changed my mind");

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "This order can no longer be cancelled.",
    });
  });
});
