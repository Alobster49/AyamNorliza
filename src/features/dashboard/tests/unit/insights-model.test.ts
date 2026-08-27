import { describe, expect, it } from "vitest";
import { buildInsightsViewModel, type InsightsPayload } from "../../analytics/insights-model";
import type { MarketSuggestion } from "@/features/market/types";

const payload: InsightsPayload = {
  pricing: [{ name: "Whole Chicken", kg: 100, revenue: 1000, realizedPerKg: 10 }],
  weight: {
    warehouseKg: 105,
    finalKg: 100,
    diffKg: 5,
    lostKg: 6,
    lostRm: 60,
    byProduct: [
      { name: "Whole Chicken", warehouseKg: 105, finalKg: 100, diffKg: 5, lostKg: 6, lostRm: 60 },
    ],
    byOrder: [
      {
        orderId: "11111111-aaaa-bbbb-cccc-000000000001",
        customerName: "Kedai A",
        deliveryDate: "2026-08-20",
        lostKg: 6,
        lostRm: 60,
      },
    ],
  },
  retention: { active: 10, newCustomers: 4, returning: 6, silent: [] },
  delivery: { attempts: 20, failed: 2, byZone: [], slotOrders: 30, slotCapacity: 60 },
};

const suggestions = [
  { product_name: "Whole Chicken", market_base: 9.5 } as unknown as MarketSuggestion,
];

describe("buildInsightsViewModel", () => {
  const vm = buildInsightsViewModel(payload, suggestions);

  it("pairs realized price with the market base and computes the gap", () => {
    expect(vm.pricing[0]!.marketBase).toBe(9.5);
    expect(vm.pricing[0]!.gapPct).toBeCloseTo(((10 - 9.5) / 9.5) * 100);
  });

  it("leaves the gap null without a matching suggestion", () => {
    const none = buildInsightsViewModel(payload, []);
    expect(none.pricing[0]!.marketBase).toBeNull();
    expect(none.pricing[0]!.gapPct).toBeNull();
  });

  it("averages market_base across multiple suggestions for the same product", () => {
    const multiVariant = [
      { product_name: "Whole Chicken", market_base: 9 } as unknown as MarketSuggestion,
      { product_name: "Whole Chicken", market_base: 10 } as unknown as MarketSuggestion,
    ];
    const averaged = buildInsightsViewModel(payload, multiVariant);
    expect(averaged.pricing[0]!.marketBase).toBe(9.5);
    expect(averaged.pricing[0]!.gapPct).toBeCloseTo(((10 - 9.5) / 9.5) * 100);
  });

  it("computes failure rate and slot fill", () => {
    expect(vm.delivery.failureRate).toBeCloseTo(0.1);
    expect(vm.delivery.slotFillPct).toBeCloseTo(50);
  });

  it("computes weight leakage percentage", () => {
    expect(vm.weight.leakagePct).toBeCloseTo((5 / 105) * 100);
  });

  it("computes loss percentage from loss-only kg", () => {
    expect(vm.weight.lossPct).toBeCloseTo((6 / 105) * 100);
  });

  it("passes loss figures and by-order rows through", () => {
    expect(vm.weight.lostRm).toBe(60);
    expect(vm.weight.byOrder[0]!.customerName).toBe("Kedai A");
    expect(vm.weight.byProduct[0]!.lostRm).toBe(60);
  });

  it("keeps lossPct at zero when nothing was weighed", () => {
    const empty = buildInsightsViewModel(
      { ...payload, weight: { ...payload.weight, warehouseKg: 0, lostKg: 0 } },
      [],
    );
    expect(empty.weight.lossPct).toBe(0);
  });
});
