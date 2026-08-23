/**
 * Unit tests for the buyer catalog/profile Server Actions. Focused on the
 * failure branches: each now returns a `messageKey` (a full path under
 * `errors.buyer.*`) instead of prose, so a client resolves it with a
 * root-namespace `useTranslations()` + `t(messageKey)`. Mock idiom copied
 * from `src/features/buyer/tests/unit/address-actions.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getPublicCatalog,
  getProductForBuyer,
  getBuyerProfile,
  updateBuyerProfile,
} from "../../server/actions";

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

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

function mockSupabaseFor({
  userId = "buyer-1" as string | null,
  tableResults = {} as Record<string, QueryResult>,
}: {
  userId?: string | null;
  tableResults?: Record<string, QueryResult>;
} = {}) {
  const from = vi.fn((table: string) => {
    const entry = tableResults[table];
    return chain(entry ?? { data: null, error: null });
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
  return { supabase };
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPublicCatalog", () => {
  it("returns catalog.orgNotFound when the org slug does not resolve", async () => {
    mockSupabaseFor({
      tableResults: { organizations: { data: null, error: null } },
    });

    const result = await getPublicCatalog("no-such-org");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.catalog.orgNotFound");
  });

  it("returns catalog.fetchFailed when the categories query errors", async () => {
    mockSupabaseFor({
      tableResults: {
        organizations: { data: { id: "org-1" }, error: null },
        categories: { data: null, error: { message: "db down" } },
      },
    });

    const result = await getPublicCatalog("ayam-norliza");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.catalog.fetchFailed");
  });
});

describe("getProductForBuyer", () => {
  it("returns catalog.productNotFound when the product does not exist", async () => {
    mockSupabaseFor({
      tableResults: { products: { data: null, error: { message: "not found" } } },
    });

    const result = await getProductForBuyer("prod-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.catalog.productNotFound");
  });
});

describe("getBuyerProfile", () => {
  it("returns profile.unauthenticated when signed out", async () => {
    mockSupabaseFor({ userId: null });

    const result = await getBuyerProfile();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.profile.unauthenticated");
  });

  it("returns profile.notFound when there is no buyer row", async () => {
    mockSupabaseFor({
      tableResults: { buyers: { data: null, error: { message: "not found" } } },
    });

    const result = await getBuyerProfile();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.profile.notFound");
  });
});

describe("updateBuyerProfile", () => {
  it("returns profile.invalidInput for a malformed payload", async () => {
    const result = await updateBuyerProfile({ phone: "x" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.profile.invalidInput");
  });

  it("returns profile.unauthenticated when signed out", async () => {
    mockSupabaseFor({ userId: null });

    const result = await updateBuyerProfile({ displayName: "New Name" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.profile.unauthenticated");
  });

  it("returns profile.updateFailed when the update query errors", async () => {
    mockSupabaseFor({
      tableResults: { buyers: { data: null, error: { message: "db down" } } },
    });

    const result = await updateBuyerProfile({ displayName: "New Name" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.profile.updateFailed");
  });
});
