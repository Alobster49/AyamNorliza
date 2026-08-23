import { describe, expect, it } from "vitest";
import { parseStoredCart } from "@/features/buyer/components/cart-context";

const V2_LINE = {
  productId: "6a2f8f6e-1111-4222-8333-444455556666",
  productName: "Ayam Kampung",
  mode: "piece",
  quantity: 2,
  sizeMinKg: 1.5,
  sizeMaxKg: 1.7,
  fallback: "cancel",
};

describe("parseStoredCart after optional price fields", () => {
  it("still accepts stored v2 lines without price fields", () => {
    expect(parseStoredCart(JSON.stringify([V2_LINE]))).toHaveLength(1);
  });
  it("accepts lines with the new optional price fields", () => {
    const parsed = parseStoredCart(
      JSON.stringify([{ ...V2_LINE, pricePerUnit: 9.9, unitType: "per_kg" }]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.pricePerUnit).toBe(9.9);
    expect(parsed[0]!.unitType).toBe("per_kg");
  });
  it("drops a line with a non-positive price", () => {
    expect(
      parseStoredCart(JSON.stringify([{ ...V2_LINE, pricePerUnit: 0, unitType: "per_kg" }])),
    ).toHaveLength(0);
  });
});
