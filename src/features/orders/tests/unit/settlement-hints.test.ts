import { describe, expect, it } from "vitest";
import { pickPriceHint, settlementReady } from "../../lib/settlement-hints";
import type { MarketSuggestion } from "@/features/market/types";

function suggestion(overrides: Partial<MarketSuggestion>): MarketSuggestion {
  return {
    variant_id: "v1",
    variant_name: "Standard",
    product_name: "Ayam Pedaging Seekor",
    current_price: 10,
    market_item_code: 1,
    market_base: 9.5,
    suggested_price: 9.8,
    latest_price_date: "2026-08-22",
    stale: false,
    ...overrides,
  };
}

describe("pickPriceHint", () => {
  it("returns the suggestion matching the product name", () => {
    const hints = [suggestion({ product_name: "Kaki Ayam", suggested_price: 5.5 }), suggestion({})];
    expect(pickPriceHint(hints, "Ayam Pedaging Seekor")).toBe(9.8);
    expect(pickPriceHint(hints, "Kaki Ayam")).toBe(5.5);
  });

  it("skips stale suggestions", () => {
    expect(pickPriceHint([suggestion({ stale: true })], "Ayam Pedaging Seekor")).toBeNull();
  });

  it("skips suggestions without a computed price", () => {
    expect(
      pickPriceHint([suggestion({ suggested_price: null as unknown as number })], "Ayam Pedaging Seekor"),
    ).toBeNull();
  });

  it("falls through a stale variant to a fresh one of the same product", () => {
    const hints = [
      suggestion({ variant_id: "v1", stale: true }),
      suggestion({ variant_id: "v2", suggested_price: 10.2 }),
    ];
    expect(pickPriceHint(hints, "Ayam Pedaging Seekor")).toBe(10.2);
  });

  it("returns null for unknown products or missing names", () => {
    expect(pickPriceHint([suggestion({})], "Telur")).toBeNull();
    expect(pickPriceHint([suggestion({})], undefined)).toBeNull();
  });
});

describe("settlementReady", () => {
  it("requires every line to have weight and price", () => {
    expect(
      settlementReady([
        { finalWeightKg: 16.5, pricePerKg: 9.8 },
        { finalWeightKg: null, pricePerKg: 9.8 },
      ]),
    ).toBe(false);
    expect(
      settlementReady([
        { finalWeightKg: 16.5, pricePerKg: 9.8 },
        { finalWeightKg: 4, pricePerKg: 0 },
      ]),
    ).toBe(true);
  });

  it("rejects zero or negative weights and negative prices", () => {
    expect(settlementReady([{ finalWeightKg: 0, pricePerKg: 5 }])).toBe(false);
    expect(settlementReady([{ finalWeightKg: 5, pricePerKg: -1 }])).toBe(false);
  });

  it("is false with no lines", () => {
    expect(settlementReady([])).toBe(false);
  });
});
