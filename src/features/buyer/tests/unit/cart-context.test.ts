/**
 * Unit tests for the buyer cart's localStorage hydration guard.
 * `parseStoredCart` must survive a corrupt/stale shape (manual edits, an
 * old cart schema, devtools tampering) without crashing the cart or
 * checkout render on every subsequent load -- it should drop the offending
 * entries instead.
 */

import { describe, expect, it } from "vitest";
import { parseStoredCart, type CartLine } from "../../components/cart-context";

const VALID_LINE: CartLine = {
  productId: "11111111-1111-1111-1111-111111111111",
  productName: "Whole Chicken",
  mode: "kg",
  quantity: 1.5,
  sizeMinKg: 1.0,
  sizeMaxKg: 2.0,
  fallback: "mix",
};

describe("parseStoredCart", () => {
  it("returns valid lines unchanged", () => {
    expect(parseStoredCart(JSON.stringify([VALID_LINE]))).toEqual([VALID_LINE]);
  });

  it("returns an empty array for invalid JSON", () => {
    expect(parseStoredCart("{not json")).toEqual([]);
  });

  it("returns an empty array when the parsed value is not an array", () => {
    expect(parseStoredCart(JSON.stringify({ productId: "x" }))).toEqual([]);
  });

  it("drops entries with the wrong shape while keeping valid ones", () => {
    const corrupt = { productId: "not-a-uuid", mode: "kg" };
    const result = parseStoredCart(JSON.stringify([VALID_LINE, corrupt]));
    expect(result).toEqual([VALID_LINE]);
  });

  it("drops a line whose quantity is non-numeric (e.g. NaN via JSON round-trip)", () => {
    const badQuantity = { ...VALID_LINE, quantity: "not-a-number" };
    expect(parseStoredCart(JSON.stringify([badQuantity]))).toEqual([]);
  });

  it("drops a piece-mode line with a fractional quantity", () => {
    const badPieceQty = { ...VALID_LINE, mode: "piece", quantity: 2.5 };
    expect(parseStoredCart(JSON.stringify([badPieceQty]))).toEqual([]);
  });

  it("drops a line where sizeMaxKg is less than sizeMinKg", () => {
    const badSizes = { ...VALID_LINE, sizeMinKg: 5, sizeMaxKg: 1 };
    expect(parseStoredCart(JSON.stringify([badSizes]))).toEqual([]);
  });

  it("drops a line with an unrecognized fallback value", () => {
    const badFallback = { ...VALID_LINE, fallback: "explode" };
    expect(parseStoredCart(JSON.stringify([badFallback]))).toEqual([]);
  });

  it("drops null/primitive entries mixed into the array", () => {
    const result = parseStoredCart(JSON.stringify([VALID_LINE, null, 42, "oops"]));
    expect(result).toEqual([VALID_LINE]);
  });
});
