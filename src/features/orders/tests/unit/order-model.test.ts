import { describe, expect, it } from "vitest";
import {
  canTransition,
  computeLineTotal,
  computeOrderTotal,
  describeFallback,
  formatPrice,
  formatWeight,
  ORDER_TRANSITIONS,
  weightWarnings,
} from "../../lib/order-model";
import type { OrderFallback, OrderItem, OrderStatus } from "../../types";

function orderItem(overrides: Partial<OrderItem>): OrderItem {
  return {
    id: "item-1",
    order_id: "order-1",
    product_id: "product-1",
    mode: "kg",
    quantity: 1,
    size_min_kg: 1.5,
    size_max_kg: 1.7,
    fallback: "mix",
    fallback_applied: null,
    is_cancelled: false,
    warehouse_weight_kg: null,
    warehouse_pieces: null,
    final_weight_kg: null,
    final_pieces: null,
    price_per_kg: null,
    line_total: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

describe("ORDER_TRANSITIONS / canTransition", () => {
  const allStatuses: OrderStatus[] = [
    "pending",
    "confirmed",
    "ready",
    "delivered",
    "closed",
    "cancelled",
  ];

  it("allows every transition declared in ORDER_TRANSITIONS", () => {
    for (const from of allStatuses) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });

  it("rejects closed -> pending", () => {
    expect(canTransition("closed", "pending")).toBe(false);
  });

  it("rejects every transition out of cancelled", () => {
    for (const to of allStatuses) {
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });

  it("rejects pending -> ready (must go through confirmed)", () => {
    expect(canTransition("pending", "ready")).toBe(false);
  });

  it("rejects delivered -> pending", () => {
    expect(canTransition("delivered", "pending")).toBe(false);
  });
});

describe("computeLineTotal", () => {
  it("rounds weight x price to the nearest cent", () => {
    // 1.234 kg x RM9.90 = 12.2166 -> rounds to 12.22
    expect(computeLineTotal(1.234, 9.9)).toBe(12.22);
  });

  it("rounds a second fractional value to the nearest cent", () => {
    // 1.231 kg x RM9.90 = 12.1869 -> rounds to 12.19
    expect(computeLineTotal(1.231, 9.9)).toBe(12.19);
  });

  it("handles a whole-number result", () => {
    expect(computeLineTotal(2, 5)).toBe(10);
  });
});

describe("computeOrderTotal", () => {
  it("skips cancelled lines", () => {
    const total = computeOrderTotal([
      { final_weight_kg: 10, price_per_kg: 9, is_cancelled: false },
      { final_weight_kg: 999, price_per_kg: 999, is_cancelled: true },
    ]);
    expect(total).toBe(90);
  });

  it("skips lines with a null final_weight_kg or price_per_kg", () => {
    const total = computeOrderTotal([
      { final_weight_kg: 10, price_per_kg: 9, is_cancelled: false },
      { final_weight_kg: null, price_per_kg: 9, is_cancelled: false },
      { final_weight_kg: 10, price_per_kg: null, is_cancelled: false },
    ]);
    expect(total).toBe(90);
  });

  it("sums multiple valid lines", () => {
    const total = computeOrderTotal([
      { final_weight_kg: 1.234, price_per_kg: 9.9, is_cancelled: false },
      { final_weight_kg: 2, price_per_kg: 5, is_cancelled: false },
    ]);
    expect(total).toBe(22.22);
  });

  it("returns 0 for an empty list", () => {
    expect(computeOrderTotal([])).toBe(0);
  });
});

describe("weightWarnings — deviation", () => {
  it("does not warn at exactly 20% deviation (boundary)", () => {
    const item = orderItem({
      warehouse_weight_kg: 10,
      final_weight_kg: 12, // 2/10 = exactly 20%
      final_pieces: null,
      warehouse_pieces: null,
      mode: "kg",
      quantity: 1,
      size_min_kg: 0.1,
      size_max_kg: 50,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "deviation")).toBe(false);
  });

  it("warns just above 20% deviation", () => {
    const item = orderItem({
      warehouse_weight_kg: 10,
      final_weight_kg: 12.01, // 2.01/10 = 20.1%
      final_pieces: null,
      warehouse_pieces: null,
      mode: "kg",
      quantity: 1,
      size_min_kg: 0.1,
      size_max_kg: 50,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "deviation")).toBe(true);
  });

  it("does not warn when either warehouse or final weight is missing", () => {
    const item = orderItem({
      warehouse_weight_kg: null,
      final_weight_kg: 12,
      final_pieces: null,
      warehouse_pieces: null,
    });
    expect(weightWarnings(item).some((w) => w.kind === "deviation")).toBe(false);
  });
});

describe("weightWarnings — size_range via final_pieces fallback chain", () => {
  it("uses final_pieces when present", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20, // avg 2.0 kg/bird if using final_pieces=10 -> outside range
      final_pieces: 10,
      warehouse_pieces: 999, // must be ignored in favour of final_pieces
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(true);
  });

  it("falls back to warehouse_pieces when final_pieces is null", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20, // avg 2.0 kg/bird using warehouse_pieces=10 -> outside range
      final_pieces: null,
      warehouse_pieces: 10,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(true);
  });

  it("falls back to quantity when mode is piece and both pieces fields are null", () => {
    const item = orderItem({
      mode: "piece",
      quantity: 10,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20, // avg 2.0 kg/bird using quantity=10 -> outside range
      final_pieces: null,
      warehouse_pieces: null,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(true);
  });

  it("has no pieces fallback for kg mode with no pieces recorded, so no size_range warning", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 20,
      final_pieces: null,
      warehouse_pieces: null,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(false);
  });

  it("does not warn when the average is within the size range", () => {
    const item = orderItem({
      mode: "kg",
      quantity: 5,
      size_min_kg: 1.5,
      size_max_kg: 1.7,
      final_weight_kg: 16, // avg 1.6 kg/bird -> within range
      final_pieces: 10,
      warehouse_pieces: null,
      warehouse_weight_kg: null,
    });
    const warnings = weightWarnings(item);
    expect(warnings.some((w) => w.kind === "size_range")).toBe(false);
  });
});

describe("formatPrice", () => {
  it("formats MYR with two decimals", () => {
    // Intl may use a non-breaking space; match flexibly.
    expect(formatPrice(12)).toMatch(/^RM\s?12\.00$/);
    expect(formatPrice(1234.5)).toMatch(/^RM\s?1,234\.50$/);
  });
});

describe("formatWeight", () => {
  it("trims trailing zeros and appends kg", () => {
    expect(formatWeight(1.5)).toBe("1.5 kg");
    expect(formatWeight(2)).toBe("2 kg");
    expect(formatWeight(1.234)).toBe("1.234 kg");
  });

  it("rounds to 3 decimal places", () => {
    expect(formatWeight(1.23456)).toBe("1.235 kg");
  });
});

describe("describeFallback", () => {
  it("returns null when no fallback was applied", () => {
    expect(describeFallback(null)).toBe(null);
  });

  it("returns the friendly label for an applied fallback", () => {
    const applied: OrderFallback = "downsize";
    expect(describeFallback(applied)).toBe("Smaller is ok");
  });
});
