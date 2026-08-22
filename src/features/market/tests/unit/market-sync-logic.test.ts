import { describe, expect, it } from "vitest";
import {
  aggregate,
  monthKeys,
  parsePremiseRow,
  parsePriceRow,
  splitCsvLine,
  TRACKED_ITEM_CODES,
  type PriceRow,
} from "../../../../../supabase/functions/market-price-sync/logic";

describe("monthKeys", () => {
  it("returns current month only after the 3rd", () => {
    expect(monthKeys(new Date(Date.UTC(2026, 7, 22)))).toEqual(["2026-08"]);
  });

  it("includes previous month during the first 3 days", () => {
    expect(monthKeys(new Date(Date.UTC(2026, 8, 2)))).toEqual(["2026-09", "2026-08"]);
  });

  it("crosses year boundary", () => {
    expect(monthKeys(new Date(Date.UTC(2027, 0, 1)))).toEqual(["2027-01", "2026-12"]);
  });
});

describe("splitCsvLine", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quotes", () => {
    expect(splitCsvLine('2.0,PASAR,"JALAN A, TAMAN B",Pasar,Perak,Kinta')).toEqual([
      "2.0", "PASAR", "JALAN A, TAMAN B", "Pasar", "Perak", "Kinta",
    ]);
  });
});

describe("parsePriceRow", () => {
  it("parses a data line", () => {
    expect(parsePriceRow("2026-08-22,123,1,9.50")).toEqual({
      date: "2026-08-22", premise_code: 123, item_code: 1, price: 9.5,
    });
  });

  it("rejects header and malformed lines", () => {
    expect(parsePriceRow("date,premise_code,item_code,price")).toBeNull();
    expect(parsePriceRow("")).toBeNull();
    expect(parsePriceRow("2026-08-22,123,1")).toBeNull();
    expect(parsePriceRow("2026-08-22,123,1,notaprice")).toBeNull();
  });
});

describe("parsePremiseRow", () => {
  it("parses float premise codes and quoted addresses", () => {
    expect(
      parsePremiseRow('2.0,PASAR BESAR IPOH,"JALAN LAKSAMANA, 30300 IPOH",Pasar Basah ,Perak,Kinta'),
    ).toEqual({ premise_code: 2, state: "Perak", district: "Kinta" });
  });

  it("rejects junk rows", () => {
    expect(parsePremiseRow('-1.0,,",",,,')).toBeNull();
    expect(parsePremiseRow("premise_code,premise,address,premise_type,state,district")).toBeNull();
  });
});

describe("aggregate", () => {
  const premiseState = new Map<number, string>([
    [1, "Selangor"], [2, "Selangor"], [3, "Selangor"], [4, "Johor"],
  ]);

  const row = (premise: number, price: number, item = 1, date = "2026-08-22"): PriceRow =>
    ({ date, premise_code: premise, item_code: item, price });

  it("computes median/avg/min/max/count per (date,item,state)", () => {
    const out = aggregate(
      [row(1, 9.0), row(2, 10.0), row(3, 12.0)],
      premiseState, new Set(["Selangor"]), TRACKED_ITEM_CODES,
    );
    expect(out).toEqual([{
      price_date: "2026-08-22", item_code: 1, state: "Selangor",
      median_price: 10.0, avg_price: 10.33, min_price: 9.0, max_price: 12.0,
      premise_count: 3,
    }]);
  });

  it("uses mean of middle two for even counts", () => {
    const out = aggregate(
      [row(1, 9.0), row(2, 10.0), row(3, 12.0), row(3, 13.0)],
      premiseState, new Set(["Selangor"]), TRACKED_ITEM_CODES,
    );
    expect(out[0]!.median_price).toBe(11.0);
  });

  it("drops non-tracked items, unknown premises, and other states", () => {
    const out = aggregate(
      [row(1, 9.0), row(99, 9.0), row(4, 9.0), row(1, 5.0, 118)],
      premiseState, new Set(["Selangor"]), TRACKED_ITEM_CODES,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.premise_count).toBe(1);
  });
});
