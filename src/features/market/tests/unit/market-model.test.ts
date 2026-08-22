import { describe, expect, it } from "vitest";
import { priceDelta, sparklinePoints } from "../../lib/market-model";

describe("sparklinePoints", () => {
  it("maps oldest->newest across the width, high price = low y", () => {
    const rows = [
      { price_date: "2026-08-01", median_price: 9 },
      { price_date: "2026-08-02", median_price: 10 },
      { price_date: "2026-08-03", median_price: 11 },
    ];
    const points = sparklinePoints(rows, 100, 30);
    const pairs = points.split(" ").map((p) => p.split(",").map(Number)) as [number, number][];
    expect(pairs).toHaveLength(3);
    expect(pairs[0]?.[0]).toBe(0);
    expect(pairs[2]?.[0]).toBe(100);
    expect(pairs[0]?.[1]).toBe(28); // min price -> bottom (height - pad)
    expect(pairs[2]?.[1]).toBe(2);  // max price -> top (pad)
  });

  it("handles a flat series without dividing by zero", () => {
    const rows = [
      { price_date: "2026-08-01", median_price: 9 },
      { price_date: "2026-08-02", median_price: 9 },
    ];
    const pairs = sparklinePoints(rows, 100, 30).split(" ").map((p) => p.split(",").map(Number)) as [number, number][];
    expect(pairs[0]?.[1]).toBe(15);
    expect(pairs[1]?.[1]).toBe(15);
  });

  it("returns empty string for fewer than 2 rows", () => {
    expect(sparklinePoints([], 100, 30)).toBe("");
    expect(sparklinePoints([{ price_date: "2026-08-01", median_price: 9 }], 100, 30)).toBe("");
  });
});

describe("priceDelta", () => {
  it("computes signed amount and percent vs current", () => {
    expect(priceDelta(10, 10.5)).toEqual({ amount: 0.5, pct: 5 });
    expect(priceDelta(10, 9)).toEqual({ amount: -1, pct: -10 });
  });

  it("rounds to 2dp and handles zero current price", () => {
    expect(priceDelta(9.99, 10.11)).toEqual({ amount: 0.12, pct: 1.2 });
    expect(priceDelta(0, 5)).toEqual({ amount: 5, pct: 0 });
  });
});
