import { describe, expect, it } from "vitest";
import {
  estimateRange,
  cartEstimate,
  formatRM,
  formatEstimate,
  deltaAgainstEstimate,
} from "@/features/buyer/lib/price-estimate";

describe("estimateRange", () => {
  it("kg mode on a per_kg variant is quantity × price, flat", () => {
    expect(
      estimateRange({ mode: "kg", quantity: 2.5, sizeMinKg: 1.3, sizeMaxKg: 1.6, pricePerUnit: 10, unitType: "per_kg" }),
    ).toEqual({ min: 25, max: 25 });
  });
  it("piece mode on a per_kg variant spans qty × sizeMin × price … qty × sizeMax × price", () => {
    expect(
      estimateRange({ mode: "piece", quantity: 2, sizeMinKg: 1.5, sizeMaxKg: 1.7, pricePerUnit: 10, unitType: "per_kg" }),
    ).toEqual({ min: 30, max: 34 });
  });
  it("piece mode on a per_piece variant is quantity × price, flat", () => {
    expect(
      estimateRange({ mode: "piece", quantity: 3, sizeMinKg: 1.5, sizeMaxKg: 1.7, pricePerUnit: 15, unitType: "per_piece" }),
    ).toEqual({ min: 45, max: 45 });
  });
  it("rounds to sen", () => {
    const r = estimateRange({ mode: "piece", quantity: 1, sizeMinKg: 1.55, sizeMaxKg: 1.55, pricePerUnit: 9.99, unitType: "per_kg" });
    expect(r.min).toBeCloseTo(15.48, 2);
    expect(r.min).toBe(r.max);
  });
});

describe("cartEstimate", () => {
  const base = { productId: "p", productName: "Ayam", mode: "piece" as const, quantity: 1, sizeMinKg: 1.5, sizeMaxKg: 1.7, fallback: "cancel" as const };
  it("sums line ranges", () => {
    expect(
      cartEstimate([
        { ...base, pricePerUnit: 10, unitType: "per_kg" },
        { ...base, mode: "kg", quantity: 2, pricePerUnit: 10, unitType: "per_kg" },
      ]),
    ).toEqual({ min: 35, max: 37 });
  });
  it("returns null when any line has no price (old stored cart)", () => {
    expect(cartEstimate([{ ...base }, { ...base, pricePerUnit: 10, unitType: "per_kg" }])).toBeNull();
  });
  it("returns null for an empty cart", () => {
    expect(cartEstimate([])).toBeNull();
  });
});

describe("formatting", () => {
  it("formatRM renders MYR with two decimals", () => {
    expect(formatRM(28)).toBe("RM 28.00");
  });
  it("formatEstimate collapses a flat range to a single tilde price", () => {
    expect(formatEstimate({ min: 28, max: 28 })).toBe("~RM 28.00");
  });
  it("formatEstimate renders a true range with an en dash", () => {
    expect(formatEstimate({ min: 25.2, max: 28.6 })).toBe("~RM 25.20–28.60");
  });
});

describe("deltaAgainstEstimate", () => {
  it("below the range", () => {
    expect(deltaAgainstEstimate({ min: 30, max: 34 }, 28.5)).toEqual({ kind: "below", amount: 1.5 });
  });
  it("above the range", () => {
    expect(deltaAgainstEstimate({ min: 30, max: 34 }, 35)).toEqual({ kind: "above", amount: 1 });
  });
  it("within the range", () => {
    expect(deltaAgainstEstimate({ min: 30, max: 34 }, 32)).toEqual({ kind: "within", amount: 0 });
  });
});
