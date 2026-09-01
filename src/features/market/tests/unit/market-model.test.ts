import { describe, expect, it } from "vitest";
import type { MarketPriceRow } from "../../types";
import {
  deltaOver,
  gradePremium,
  heatBin,
  heatGrid,
  nationalSeries,
  quantileThresholds,
  seriesByState,
  sparklinePoints,
  summarize,
  watchlist,
} from "../../lib/market-model";

function row(
  state: string,
  price_date: string,
  median: number,
  premise_count = 10,
  item_code = 1,
): MarketPriceRow {
  return {
    state,
    price_date,
    item_code,
    median_price: median,
    avg_price: median,
    min_price: median - 1,
    max_price: median + 1,
    premise_count,
    created_at: "2026-09-01T00:00:00Z",
  };
}

const rows: MarketPriceRow[] = [
  row("Johor", "2026-08-30", 9.1, 100),
  row("Johor", "2026-08-31", 9.0, 100),
  row("Johor", "2026-09-01", 8.99, 104),
  row("Sabah", "2026-09-01", 12.89, 11),
  row("Sabah", "2026-08-31", 12.8, 12),
  row("Sabah", "2026-08-30", 12.7, 12),
  row("Selangor", "2026-09-01", 9.89, 1),
  row("Selangor", "2026-08-31", 9.9, 1),
  // super grade — must be ignored when asking for item 1
  row("Johor", "2026-09-01", 11.2, 5, 2),
];

describe("seriesByState", () => {
  it("groups one item per state, date-ascending, ignoring other items", () => {
    const byState = seriesByState(rows, 1);
    expect([...byState.keys()].sort()).toEqual(["Johor", "Sabah", "Selangor"]);
    expect(byState.get("Sabah")?.map((p) => p.date)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
    expect(byState.get("Johor")?.at(-1)?.median).toBe(8.99);
  });
});

describe("nationalSeries", () => {
  it("weights state medians by premise count and reports quartiles", () => {
    const national = nationalSeries(seriesByState(rows, 1));
    expect(national.map((p) => p.date)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
    const latest = national.at(-1)!;
    // (8.99*104 + 12.89*11 + 9.89*1) / 116
    expect(latest.median).toBe(9.37);
    expect(latest.states).toBe(3);
    expect(latest.premises).toBe(116);
    expect(latest.low).toBe(8.99);
    expect(latest.high).toBe(12.89);
    expect(latest.q1).toBe(9.89); // nearest rank of 3 values rounds up
    expect(latest.q3).toBe(12.89);
  });

  it("skips dates where no state reported", () => {
    const national = nationalSeries(seriesByState([row("Johor", "2026-09-01", 9)], 1));
    expect(national).toHaveLength(1);
  });
});

describe("deltaOver", () => {
  const points = [
    { date: "2026-08-20", median: 10 },
    { date: "2026-08-25", median: 9 },
    { date: "2026-09-01", median: 9.9 },
  ];
  it("compares against the latest point at least N days back", () => {
    expect(deltaOver(points, 1)).toEqual({ abs: 0.9, pct: 10 });
    expect(deltaOver(points, 7)).toEqual({ abs: 0.9, pct: 10 }); // 08-25 is exactly 7 days back
    expect(deltaOver(points, 8)).toEqual({ abs: -0.1, pct: -1 });
  });
  it("returns null when the series does not reach back far enough", () => {
    expect(deltaOver(points, 30)).toBeNull();
    expect(deltaOver([], 1)).toBeNull();
  });
});

describe("watchlist", () => {
  it("lists every state dearest-first with deltas and a spark", () => {
    const list = watchlist(seriesByState(rows, 1));
    expect(list.map((r) => r.state)).toEqual(["Sabah", "Selangor", "Johor"]);
    expect(list[0]).toMatchObject({ last: 12.89, premises: 11, d1: { abs: 0.09 } });
    expect(list[0]?.d7).toBeNull();
    expect(list[2]?.spark).toEqual([9.1, 9.0, 8.99]);
  });
});

describe("heat grid", () => {
  it("splits values into equal-count bins", () => {
    const thresholds = quantileThresholds([1, 2, 3, 4, 5, 6, 7, 8], 4);
    expect(thresholds).toHaveLength(3);
    expect(heatBin(1, thresholds)).toBe(0);
    expect(heatBin(8, thresholds)).toBe(3);
    expect(heatBin(8, [])).toBe(0);
  });

  it("builds last-N dates × states with nulls for missing days", () => {
    const grid = heatGrid(seriesByState(rows, 1), 2);
    expect(grid.dates).toEqual(["2026-08-31", "2026-09-01"]);
    expect(grid.rows.map((r) => r.state)).toEqual(["Sabah", "Selangor", "Johor"]);
    expect(grid.rows[1]?.cells).toEqual([9.9, 9.89]);
    const sparse = heatGrid(seriesByState(rows, 1), 3);
    expect(sparse.rows[1]?.cells).toEqual([null, 9.9, 9.89]);
  });
});

describe("summarize", () => {
  it("reports dearest, cheapest, spread and premises on the latest day", () => {
    expect(summarize(seriesByState(rows, 1))).toEqual({
      latestDate: "2026-09-01",
      dearest: { state: "Sabah", last: 12.89 },
      cheapest: { state: "Johor", last: 8.99 },
      spread: 3.9,
      premises: 116,
    });
  });
  it("is all-null on empty input", () => {
    expect(summarize(new Map())).toEqual({
      latestDate: null, dearest: null, cheapest: null, spread: null, premises: 0,
    });
  });
});

describe("gradePremium", () => {
  it("uses the latest day both grades have", () => {
    const std = nationalSeries(seriesByState(rows, 1));
    const sup = nationalSeries(seriesByState(rows, 2));
    expect(gradePremium(std, sup)).toBe(1.83); // 11.20 - 9.37
    expect(gradePremium(std, [])).toBeNull();
  });
});

describe("sparklinePoints", () => {
  it("maps oldest->newest across the width, high price = low y", () => {
    const pairs = sparklinePoints([9, 10, 11], 100, 30)
      .split(" ")
      .map((p) => p.split(",").map(Number)) as [number, number][];
    expect(pairs).toHaveLength(3);
    expect(pairs[0]).toEqual([0, 28]);
    expect(pairs[2]).toEqual([100, 2]);
  });
  it("handles a flat series and short input", () => {
    expect(sparklinePoints([9, 9], 100, 30)).toBe("0,15 100,15");
    expect(sparklinePoints([9], 100, 30)).toBe("");
  });
});
