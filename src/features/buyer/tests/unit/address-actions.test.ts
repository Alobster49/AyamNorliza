/**
 * Unit tests for buyer address-book Server Actions. The Supabase server
 * client is mocked so no database is required; `requireBuyer` (in
 * `@/lib/auth/buyer-auth`) is exercised indirectly through the actions
 * since it has no dedicated test file of its own. Mock idiom copied from
 * `src/features/orders/tests/unit/schedule-actions.test.ts` and extended
 * to support multiple sequential queries against the same table within a
 * single action call (e.g. a count check followed by an insert).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createAddress,
  deleteAddress,
  listMyAddresses,
  setDefaultAddress,
} from "../../server/address-actions";

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
};

/**
 * A minimal chainable Supabase query-builder stub. Every builder method
 * (select/insert/update/delete/eq/...) returns the same object so calls
 * can be chained in any order; `.single()`/`.maybeSingle()` resolve the
 * configured result, and the object is itself thenable so code that
 * `await`s the builder directly (no terminal call, e.g. a bare
 * `.select(..., { count, head: true })`) also resolves the configured
 * result.
 */
function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "order", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const defaultBuyerRow = {
  id: "buyer-1",
  organization_id: "org-1",
  display_name: "Test Buyer",
  address: null,
  phone: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

type Builder = ReturnType<typeof chain>;

/**
 * Builds a mock Supabase client. `from("buyers")` is wired to satisfy
 * `requireBuyer`; any other table name is served from `tableResults`,
 * consumed in order for repeated calls against the same table (the last
 * entry repeats once the array is exhausted), falling back to
 * `{ data: null, error: null }`. Every builder returned from `from()` is
 * recorded in `buildersByTable`, in call order, so a test can reach back
 * into a specific call (e.g. "the insert call") and assert on its mock —
 * not just on the value it echoed back.
 */
function mockSupabaseFor({
  userId = "buyer-1",
  buyerRow = defaultBuyerRow as Record<string, unknown> | null,
  tableResults = {} as Record<string, QueryResult | QueryResult[]>,
}: {
  userId?: string | null;
  buyerRow?: Record<string, unknown> | null;
  tableResults?: Record<string, QueryResult | QueryResult[]>;
}) {
  const callCounts: Record<string, number> = {};
  const buildersByTable: Record<string, Builder[]> = {};
  const from = vi.fn((table: string) => {
    let builder: Builder;
    if (table === "buyers") {
      builder = chain({ data: userId ? buyerRow : null, error: null });
    } else {
      const entry = tableResults[table];
      if (!entry) {
        builder = chain({ data: null, error: null });
      } else {
        const results = Array.isArray(entry) ? entry : [entry];
        const idx = Math.min(callCounts[table] ?? 0, results.length - 1);
        callCounts[table] = (callCounts[table] ?? 0) + 1;
        builder = chain(results[idx] ?? { data: null, error: null });
      }
    }
    buildersByTable[table] = buildersByTable[table] ?? [];
    buildersByTable[table].push(builder);
    return builder;
  });
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from,
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return { supabase, buildersByTable };
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("address actions", () => {
  it("listMyAddresses returns unauthenticated when signed out", async () => {
    mockSupabaseFor({ userId: null });

    const result = await listMyAddresses();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unauthenticated");
      expect(result.messageKey).toBe("errors.buyer.address.unauthenticated");
    }
  });

  it("listMyAddresses returns the notABuyer key when signed in but not a buyer", async () => {
    mockSupabaseFor({ buyerRow: null });

    const result = await listMyAddresses();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unauthenticated");
      expect(result.messageKey).toBe("errors.buyer.address.notABuyer");
    }
  });

  it("listMyAddresses returns address.loadFailed when the query errors", async () => {
    mockSupabaseFor({
      tableResults: {
        buyer_addresses: { data: null, error: { message: "db down" } },
      },
    });

    const result = await listMyAddresses();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("internal");
      expect(result.messageKey).toBe("errors.buyer.address.loadFailed");
    }
  });

  it("createAddress rejects a malformed postcode with a field error", async () => {
    const result = await createAddress({
      addressLine: "1 Jalan Test",
      postcode: "123",
      state: "Johor",
      area: "Johor Bahru",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.address.invalidAddress");
      expect(result.fieldErrors?.postcode).toBeTruthy();
    }
  });

  it("createAddress inserts and returns the mapped row", async () => {
    const { buildersByTable } = mockSupabaseFor({
      tableResults: {
        buyer_addresses: [
          // 1. existing-address count check -> 0, so makeDefault is forced true.
          { data: null, error: null, count: 0 },
          // 2. insert().select("*").single() -> the new row (snake_case).
          {
            data: {
              id: "addr-1",
              address_line: "1 Jalan Test",
              postcode: "80000",
              state: "Johor",
              area: "Johor Bahru",
              is_default: true,
              created_at: "2026-08-22T00:00:00Z",
            },
            error: null,
          },
        ],
      },
    });

    const result = await createAddress({
      addressLine: "1 Jalan Test",
      postcode: "80000",
      state: "Johor",
      area: "Johor Bahru",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isDefault).toBe(true);
      expect(result.data.postcode).toBe("80000");
    }

    // Assert against the actual insert payload, not just the mocked
    // echo: with the count check reporting 0 existing addresses, the
    // action must itself compute `is_default: true` (the "first-ever
    // address is forced default" rule) rather than the test merely
    // reflecting a value it seeded. Count check (index 0) then insert
    // (index 1) are two separate `from("buyer_addresses")` calls.
    const insertBuilder = buildersByTable.buyer_addresses?.[1];
    expect(insertBuilder).toBeDefined();
    expect(insertBuilder?.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        buyer_id: "buyer-1",
        address_line: "1 Jalan Test",
        postcode: "80000",
        state: "Johor",
        area: "Johor Bahru",
        is_default: true,
      }),
    );
  });

  it("createAddress returns address.saveFailed when the insert errors", async () => {
    mockSupabaseFor({
      tableResults: {
        buyer_addresses: [
          // 1. existing-address count check -> 0.
          { data: null, error: null, count: 0 },
          // 2. insert().select("*").single() -> fails.
          { data: null, error: { message: "db down" } },
        ],
      },
    });

    const result = await createAddress({
      addressLine: "1 Jalan Test",
      postcode: "80000",
      state: "Johor",
      area: "Johor Bahru",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("internal");
      expect(result.messageKey).toBe("errors.buyer.address.saveFailed");
    }
  });

  it("setDefaultAddress rejects an id that is not a uuid", async () => {
    const result = await setDefaultAddress("not-a-uuid");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.address.invalidId");
    }
  });

  it("setDefaultAddress returns not_found for a stale/nonexistent id without touching the current default", async () => {
    const { buildersByTable } = mockSupabaseFor({
      tableResults: {
        // select("id").eq("id", addressId).maybeSingle() -> the target
        // row does not exist (or was filtered out by RLS).
        buyer_addresses: { data: null, error: null },
      },
    });

    const result = await setDefaultAddress("d0000000-0000-0000-0000-00000000000d");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
      expect(result.messageKey).toBe("errors.buyer.address.notFound");
    }

    // Only the target-existence check should have run; the action must
    // return before clearing the buyer's current default, otherwise a
    // stale id would leave the buyer with no default address at all.
    expect(buildersByTable.buyer_addresses).toHaveLength(1);
    expect(buildersByTable.buyer_addresses?.[0]?.update).not.toHaveBeenCalled();
  });

  it("deleteAddress rejects an id that is not a uuid", async () => {
    const result = await deleteAddress("not-a-uuid");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.address.invalidId");
    }
  });

  it("deleteAddress returns address.deleteFailed when the query errors", async () => {
    mockSupabaseFor({
      tableResults: {
        buyer_addresses: { data: null, error: { message: "db down" } },
      },
    });

    const result = await deleteAddress("d0000000-0000-0000-0000-00000000000d");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("internal");
      expect(result.messageKey).toBe("errors.buyer.address.deleteFailed");
    }
  });

  it("deleteAddress returns not_found when the row does not belong to the buyer", async () => {
    mockSupabaseFor({
      tableResults: {
        // delete().eq("id", addressId).select("id, is_default") -> RLS
        // filtered the row out, so nothing came back.
        buyer_addresses: { data: [], error: null },
      },
    });

    const result = await deleteAddress("d0000000-0000-0000-0000-00000000000d");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
      expect(result.messageKey).toBe("errors.buyer.address.notFound");
    }
  });
});
