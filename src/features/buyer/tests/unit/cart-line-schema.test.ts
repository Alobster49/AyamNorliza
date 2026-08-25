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

describe("parseStoredCart backward compatibility", () => {
  it("still accepts stored v2 lines", () => {
    expect(parseStoredCart(JSON.stringify([V2_LINE]))).toHaveLength(1);
  });
  it("accepts legacy lines that still carry the now-removed price fields, dropping them silently", () => {
    const parsed = parseStoredCart(
      JSON.stringify([{ ...V2_LINE, pricePerUnit: 9.9, unitType: "per_kg" }]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).not.toHaveProperty("pricePerUnit");
    expect(parsed[0]).not.toHaveProperty("unitType");
  });
});
