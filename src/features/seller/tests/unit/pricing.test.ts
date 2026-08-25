import { describe, expect, it } from "vitest";
import { formatPrice, formatQuantity, isValidQuantity, lineSubtotal } from "../../lib/pricing";

describe("formatPrice", () => {
  it("formats MYR with two decimals", () => {
    // Intl may use a non-breaking space; match flexibly.
    expect(formatPrice(12)).toMatch(/^RM\s?12\.00$/);
    expect(formatPrice(1234.5)).toMatch(/^RM\s?1,234\.50$/);
  });
});

describe("formatQuantity", () => {
  it("shows kg with up to 3 decimals, trimmed", () => {
    expect(formatQuantity(1.5, "per_kg")).toBe("1.5 kg");
    expect(formatQuantity(2, "per_kg")).toBe("2 kg");
    expect(formatQuantity(0.25, "per_kg")).toBe("0.25 kg");
  });
  it("shows pcs for per_piece", () => {
    expect(formatQuantity(2, "per_piece")).toBe("2 pcs");
    expect(formatQuantity(1, "per_piece")).toBe("1 pc");
  });
});

describe("lineSubtotal", () => {
  it("multiplies and rounds to 2dp", () => {
    expect(lineSubtotal(12, 1.5)).toBe(18);
    expect(lineSubtotal(9.99, 0.333)).toBe(3.33);
  });
});

describe("isValidQuantity", () => {
  it("accepts decimals for per_kg", () => {
    expect(isValidQuantity(1.5, "per_kg")).toBe(true);
    expect(isValidQuantity(0, "per_kg")).toBe(false);
    expect(isValidQuantity(-1, "per_kg")).toBe(false);
  });
  it("requires positive integers for per_piece", () => {
    expect(isValidQuantity(2, "per_piece")).toBe(true);
    expect(isValidQuantity(1.5, "per_piece")).toBe(false);
    expect(isValidQuantity(0, "per_piece")).toBe(false);
  });
});
