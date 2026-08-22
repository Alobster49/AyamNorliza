/**
 * Unit tests for applySuggestedPrice's validation and update payload. The
 * Supabase server client and next/cache's revalidatePath are mocked so no
 * database or request context is required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applySuggestedPrice } from "../../server/actions";

/**
 * A minimal chainable Supabase query-builder stub for `product_variants`.
 * `.update(...)` and `.eq(...)` are captured so tests can assert on the
 * exact payload; the object is thenable so `await`ing the builder directly
 * resolves the configured result.
 */
function mockSupabase() {
  const update = vi.fn(() => builder);
  const eq = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const builder = { update, eq };
  const from = vi.fn(() => builder);
  const supabase = { from };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return { supabase, update, eq, from };
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("applySuggestedPrice validation", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["zero", 0],
    ["negative", -5],
  ])("rejects %s without touching the DB", async (_label, price) => {
    const { from } = mockSupabase();

    await expect(applySuggestedPrice("variant-1", price)).rejects.toThrow("Invalid price");

    expect(from).not.toHaveBeenCalled();
  });
});

describe("applySuggestedPrice update", () => {
  it("rounds 10.126 to 10.13 in the update payload", async () => {
    const { from, update, eq } = mockSupabase();

    await applySuggestedPrice("variant-1", 10.126);

    expect(from).toHaveBeenCalledWith("product_variants");
    expect(update).toHaveBeenCalledWith({ price_per_unit: 10.13 });
    expect(eq).toHaveBeenCalledWith("id", "variant-1");
  });

  it("revalidates market-prices and products paths when orgSlug is passed", async () => {
    mockSupabase();

    await applySuggestedPrice("variant-1", 12, "ayam-norliza-pilot");

    expect(revalidatePath).toHaveBeenCalledWith("/ayam-norliza-pilot/market-prices");
    expect(revalidatePath).toHaveBeenCalledWith("/ayam-norliza-pilot/products");
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("does not revalidate when orgSlug is omitted", async () => {
    mockSupabase();

    await applySuggestedPrice("variant-1", 12);

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
