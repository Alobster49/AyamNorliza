import { describe, expect, it } from "vitest";
import { buildSalesViewModel, type SalesPayload } from "../../analytics/sales-model";

const payload: SalesPayload = {
  kpis: { revenue: 200, orders: 4, kg: 10 },
  previous: { revenue: 100, orders: 2, kg: 4 },
  series: [{ bucket: "2026-08-02", revenue: 200, orders: 4 }],
  funnel: { pending: 3, delivered: 4, cancelled: 1 },
  topProducts: [{ name: "Whole Chicken", revenue: 150, kg: 7 }],
  topCustomers: [{ name: "Kak Jah", revenue: 120, orders: 2 }],
  topZones: [{ name: "Zon A", revenue: 200, orders: 4 }],
};

describe("buildSalesViewModel", () => {
  const vm = buildSalesViewModel(payload, "2026-08-01", "2026-08-03", "day");

  it("computes deltas against the previous period", () => {
    expect(vm.revenue).toEqual({ value: 200, previous: 100, deltaPct: 100 });
    expect(vm.orders.deltaPct).toBe(100);
  });

  it("derives AOV and RM/kg, with zero-safe previous", () => {
    expect(vm.aov.value).toBe(50); // 200 / 4
    expect(vm.rmPerKg.value).toBe(20); // 200 / 10
    const empty = buildSalesViewModel(
      { ...payload, kpis: { revenue: 0, orders: 0, kg: 0 }, previous: { revenue: 0, orders: 0, kg: 0 } },
      "2026-08-01", "2026-08-03", "day",
    );
    expect(empty.aov.value).toBe(0);
    expect(empty.revenue.deltaPct).toBeNull(); // previous 0 -> no delta
  });

  it("fills day-bucket gaps with zero rows", () => {
    expect(vm.series).toEqual([
      { bucket: "2026-08-01", revenue: 0, orders: 0 },
      { bucket: "2026-08-02", revenue: 200, orders: 4 },
      { bucket: "2026-08-03", revenue: 0, orders: 0 },
    ]);
  });

  it("orders the funnel and computes the cancellation rate", () => {
    expect(vm.funnel.map((f) => f.status)).toEqual([
      "pending", "confirmed", "ready", "delivered", "closed", "cancelled",
    ]);
    expect(vm.funnel[0]).toEqual({ status: "pending", count: 3 });
    expect(vm.cancellationRate).toBeCloseTo(1 / 8);
  });
});
