import { describe, expect, it } from "vitest";
import {
  BlockInputSchema,
  CloseOrderSchema,
  CompleteTaskSchema,
  ConfirmOrderSchema,
  FALLBACK_LABELS,
  FALLBACKS,
  OrderItemInputSchema,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  PlaceOrderSchema,
  SlotInputSchema,
  ZoneInputSchema,
} from "../../types";

const validItem = {
  productId: "11111111-1111-1111-1111-111111111111",
  mode: "kg" as const,
  quantity: 1.5,
  sizeMinKg: 1.5,
  sizeMaxKg: 1.7,
  fallback: "mix" as const,
};

describe("OrderItemInputSchema", () => {
  it("rejects non-integer quantity in piece mode", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      mode: "piece",
      quantity: 1.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.quantity?.[0]).toBeDefined();
    }
  });

  it("accepts integer quantity in piece mode", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      mode: "piece",
      quantity: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts decimal quantity in kg mode", () => {
    const result = OrderItemInputSchema.safeParse({ ...validItem, mode: "kg", quantity: 1.234 });
    expect(result.success).toBe(true);
  });

  it("rejects sizeMaxKg below sizeMinKg", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      sizeMinKg: 2,
      sizeMaxKg: 1.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.sizeMaxKg?.[0]).toBeDefined();
    }
  });

  it("accepts sizeMaxKg equal to sizeMinKg", () => {
    const result = OrderItemInputSchema.safeParse({
      ...validItem,
      sizeMinKg: 1.6,
      sizeMaxKg: 1.6,
    });
    expect(result.success).toBe(true);
  });
});

describe("PlaceOrderSchema", () => {
  const base = {
    organizationSlug: "ayam-norliza-pilot",
    zoneId: "11111111-1111-1111-1111-111111111111",
    slotId: "22222222-2222-2222-2222-222222222222",
    address: "123 Jalan Ayam",
    items: [validItem],
  };

  it("accepts a well-formed ISO date", () => {
    const result = PlaceOrderSchema.safeParse({ ...base, deliveryDate: "2026-08-11" });
    expect(result.success).toBe(true);
  });

  it("rejects a slash-formatted date", () => {
    const result = PlaceOrderSchema.safeParse({ ...base, deliveryDate: "08/11/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects a date with a time component", () => {
    const result = PlaceOrderSchema.safeParse({
      ...base,
      deliveryDate: "2026-08-11T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a single-digit month/day date", () => {
    const result = PlaceOrderSchema.safeParse({ ...base, deliveryDate: "2026-8-1" });
    expect(result.success).toBe(false);
  });
});

describe("CompleteTaskSchema", () => {
  const base = {
    organizationSlug: "ayam-norliza-pilot",
    taskId: "11111111-1111-1111-1111-111111111111",
  };

  it("rejects zero weightKg", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative weightKg", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: -5 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts weightKg at the upper bound of 1000", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: 1000 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects weightKg above 1000", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [{ itemId: "22222222-2222-2222-2222-222222222222", weightKg: 1000.1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional integer pieces value", () => {
    const result = CompleteTaskSchema.safeParse({
      ...base,
      weights: [
        { itemId: "22222222-2222-2222-2222-222222222222", weightKg: 12.5, pieces: 8 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("FALLBACK_LABELS completeness", () => {
  it("has exactly one label per FALLBACKS entry, in the same set", () => {
    expect(Object.keys(FALLBACK_LABELS).sort()).toEqual([...FALLBACKS].sort());
  });

  it("every label is a non-empty string", () => {
    for (const key of FALLBACKS) {
      expect(typeof FALLBACK_LABELS[key]).toBe("string");
      expect(FALLBACK_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it("matches the exact copy from the design", () => {
    expect(FALLBACK_LABELS.cancel).toBe("Cancel my order");
    expect(FALLBACK_LABELS.mix).toBe("Mix sizes");
    expect(FALLBACK_LABELS.upsize).toBe("Bigger is ok");
    expect(FALLBACK_LABELS.downsize).toBe("Smaller is ok");
  });
});

describe("ORDER_STATUS_LABELS and ORDER_STATUS_COLORS completeness", () => {
  it("has exactly one label and one color per ORDER_STATUSES entry", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...ORDER_STATUSES].sort());
    expect(Object.keys(ORDER_STATUS_COLORS).sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe("ConfirmOrderSchema", () => {
  it("requires at least one decision", () => {
    const result = ConfirmOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      decisions: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed decision list", () => {
    const result = ConfirmOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      decisions: [{ itemId: "22222222-2222-2222-2222-222222222222", available: false }],
    });
    expect(result.success).toBe(true);
  });
});

describe("CloseOrderSchema", () => {
  it("rejects a negative pricePerKg", () => {
    const result = CloseOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      lines: [
        {
          itemId: "22222222-2222-2222-2222-222222222222",
          finalWeightKg: 12,
          pricePerKg: -1,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts pricePerKg of zero (nonnegative)", () => {
    const result = CloseOrderSchema.safeParse({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "11111111-1111-1111-1111-111111111111",
      lines: [
        {
          itemId: "22222222-2222-2222-2222-222222222222",
          finalWeightKg: 12,
          pricePerKg: 0,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("ZoneInputSchema", () => {
  it("defaults displayOrder and isActive when omitted", () => {
    const result = ZoneInputSchema.safeParse({ name: "Zone 1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayOrder).toBe(0);
      expect(result.data.isActive).toBe(true);
    }
  });
});

describe("SlotInputSchema", () => {
  const base = {
    truckId: "11111111-1111-1111-1111-111111111111",
    weekday: 1,
    maxOrders: 10,
  };

  it("rejects endTime not after startTime", () => {
    const result = SlotInputSchema.safeParse({
      ...base,
      startTime: "12:00",
      endTime: "09:00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts endTime after startTime", () => {
    const result = SlotInputSchema.safeParse({
      ...base,
      startTime: "09:00",
      endTime: "12:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a null maxOrders", () => {
    const result = SlotInputSchema.safeParse({
      ...base,
      maxOrders: null,
      startTime: "09:00",
      endTime: "12:00",
    });
    expect(result.success).toBe(true);
  });
});

describe("BlockInputSchema", () => {
  it("accepts a null truckId (all trucks blocked)", () => {
    const result = BlockInputSchema.safeParse({
      blockDate: "2026-12-25",
      truckId: null,
    });
    expect(result.success).toBe(true);
  });
});
