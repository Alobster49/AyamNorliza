import { describe, expect, it } from "vitest";
import { buildTodayViewModel, type TodayPayload } from "../../analytics/today-model";

const payload: TodayPayload = {
  date: "2026-08-24",
  runs: [
    { id: "r1", truckName: "Alpha", truckCode: "A", status: "departed", ordersTotal: 10, delivered: 6, failed: 1 },
  ],
  tasksPending: 3,
  tasksDoneToday: 5,
  ordersWithoutRun: 2,
  marketPriceDate: "2026-08-20",
  marketStale: true,
};

describe("buildTodayViewModel", () => {
  const vm = buildTodayViewModel(payload);
  it("computes run progress", () => {
    expect(vm.runs[0]!.progressPct).toBe(60);
  });
  it("collects alerts for unassigned orders and stale market prices", () => {
    expect(vm.alerts).toEqual([
      { kind: "ordersWithoutRun", count: 2 },
      { kind: "marketStale", count: 0 },
    ]);
  });
  it("emits no alerts when everything is fine", () => {
    const fine = buildTodayViewModel({ ...payload, ordersWithoutRun: 0, marketStale: false });
    expect(fine.alerts).toEqual([]);
  });
});
