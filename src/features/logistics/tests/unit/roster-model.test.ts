import { describe, expect, it } from "vitest";
import {
  buildRoster,
  mondayOf,
  rankCoverCandidates,
  weekdayOf,
  type RosterInput,
} from "../../lib/roster-model";

// Window: Mon 31 Aug 2026 .. Sun 13 Sep 2026, today Wed 2 Sep.
const FROM = "2026-08-31";
const TODAY = "2026-09-02";
const ALL_WEEK = [1, 2, 3, 4, 5, 6];

function base(over: Partial<RosterInput> = {}): RosterInput {
  return {
    fromDate: FROM,
    days: 14,
    today: TODAY,
    trucks: [
      { id: "t1", code: "JHR-01", name: "Batu Pahat", regularDriverId: "azman", operatingWeekdays: ALL_WEEK },
      { id: "t2", code: "JHR-02", name: "Kluang", regularDriverId: "faizal", operatingWeekdays: ALL_WEEK },
    ],
    drivers: [
      { userId: "azman", name: "Azman", regularTruckId: "t1" },
      { userId: "faizal", name: "Faizal", regularTruckId: "t2" },
      { userId: "ravi", name: "Ravi", regularTruckId: null },
    ],
    leave: [],
    covers: [],
    runs: [],
    blocks: [],
    holidays: [{ date: "2026-08-31", name: "Merdeka" }],
    ...over,
  };
}

const cell = (view: ReturnType<typeof buildRoster>, code: string, date: string) =>
  view.truckRows.find((r) => r.truck.code === code)!.cells.find((c) => c.date === date)!;

describe("date helpers", () => {
  it("weekdayOf uses 0 = Sunday like delivery_slots", () => {
    expect(weekdayOf("2026-09-06")).toBe(0);
    expect(weekdayOf("2026-08-31")).toBe(1);
  });
  it("mondayOf walks back to the Monday of that week", () => {
    expect(mondayOf("2026-09-02")).toBe("2026-08-31");
    expect(mondayOf("2026-09-06")).toBe("2026-08-31");
    expect(mondayOf("2026-08-31")).toBe("2026-08-31");
  });
});

describe("buildRoster days", () => {
  it("emits one day per window slot with holiday and today marked", () => {
    const view = buildRoster(base());
    expect(view.days).toHaveLength(14);
    expect(view.days[0]).toMatchObject({ date: "2026-08-31", holiday: "Merdeka", isToday: false });
    expect(view.days[2]).toMatchObject({ date: "2026-09-02", isToday: true });
  });
});

describe("truck cells", () => {
  it("is regular on an ordinary operating day", () => {
    const view = buildRoster(base());
    expect(cell(view, "JHR-01", "2026-09-01")).toMatchObject({ state: "regular", driverId: "azman", driverName: "Azman" });
  });

  it("is holiday on a public holiday and off on a non-operating weekday", () => {
    const view = buildRoster(base());
    expect(cell(view, "JHR-01", "2026-08-31").state).toBe("holiday");
    expect(cell(view, "JHR-01", "2026-09-06").state).toBe("off");
  });

  it("is off when a schedule block covers the truck or the whole org", () => {
    const view = buildRoster(base({ blocks: [{ date: "2026-09-01", truckId: "t1" }, { date: "2026-09-03", truckId: null }] }));
    expect(cell(view, "JHR-01", "2026-09-01")!.state).toBe("off");
    expect(cell(view, "JHR-02", "2026-09-01")!.state).toBe("regular");
    expect(cell(view, "JHR-02", "2026-09-03")!.state).toBe("off");
  });

  it("is gap when the regular driver has approved leave and no cover", () => {
    const view = buildRoster(base({ leave: [{ userId: "azman", startDate: "2026-09-03", endDate: "2026-09-04", status: "approved", typeName: "Annual" }] }));
    expect(cell(view, "JHR-01", "2026-09-03")).toMatchObject({ state: "gap", driverId: null });
    expect(view.gaps).toHaveLength(2);
    expect(view.gaps[0]).toMatchObject({ truckCode: "JHR-01", date: "2026-09-03", reason: { kind: "leave", driverName: "Azman", leaveType: "Annual" } });
  });

  it("is cover when a cover row exists, and the gap disappears", () => {
    const view = buildRoster(base({
      leave: [{ userId: "azman", startDate: "2026-09-03", endDate: "2026-09-03", status: "approved", typeName: "Annual" }],
      covers: [{ truckId: "t1", date: "2026-09-03", driverId: "ravi", note: null }],
    }));
    expect(cell(view, "JHR-01", "2026-09-03")).toMatchObject({ state: "cover", driverId: "ravi", driverName: "Ravi" });
    expect(view.gaps).toHaveLength(0);
  });

  it("is gap again when the cover driver is themselves on leave", () => {
    const view = buildRoster(base({
      leave: [{ userId: "ravi", startDate: "2026-09-03", endDate: "2026-09-03", status: "approved", typeName: "Medical" }],
      covers: [{ truckId: "t1", date: "2026-09-03", driverId: "ravi", note: null }],
    }));
    expect(cell(view, "JHR-01", "2026-09-03").state).toBe("gap");
    expect(view.gaps[0]!.reason).toEqual({ kind: "leave", driverName: "Ravi", leaveType: "Medical", startDate: "2026-09-03", endDate: "2026-09-03", status: "approved" });
  });

  it("is risk when the planned driver has pending leave", () => {
    const view = buildRoster(base({ leave: [{ userId: "faizal", startDate: "2026-09-09", endDate: "2026-09-11", status: "pending", typeName: "Annual" }] }));
    expect(cell(view, "JHR-02", "2026-09-10")!.state).toBe("risk");
    expect(view.risks).toHaveLength(3);
    expect(view.gaps).toHaveLength(0);
  });

  it("is gap on every operating day for a truck with no regular driver", () => {
    const view = buildRoster(base({ trucks: [{ id: "t3", code: "JHR-03", name: "Spare", regularDriverId: null, operatingWeekdays: [1, 3, 5] }] }));
    const states = view.truckRows[0]!.cells.map((c) => c.state);
    // Mon 31 holiday, Tue off, Wed gap, Thu off, Fri gap, Sat off, Sun off, Mon gap, ...
    expect(states.slice(0, 8)).toEqual(["holiday", "off", "gap", "off", "gap", "off", "off", "gap"]);
    expect(view.gaps[0]!.reason).toEqual({ kind: "no_regular" });
  });

  it("uses an existing run's driver over the regular driver", () => {
    const view = buildRoster(base({ runs: [{ truckId: "t1", runDate: "2026-09-02", driverId: "ravi" }] }));
    expect(cell(view, "JHR-01", "2026-09-02")).toMatchObject({ state: "cover", driverId: "ravi" });
  });

  it("a cover row wins over an existing run's driver", () => {
    const view = buildRoster(base({
      runs: [{ truckId: "t1", runDate: "2026-09-02", driverId: "azman" }],
      covers: [{ truckId: "t1", date: "2026-09-02", driverId: "ravi", note: null }],
    }));
    expect(cell(view, "JHR-01", "2026-09-02")!.driverId).toBe("ravi");
  });
});

describe("driver cells and free lists", () => {
  it("marks driving, cover, leave, pending, free, holiday and off", () => {
    const view = buildRoster(base({
      leave: [
        { userId: "azman", startDate: "2026-09-03", endDate: "2026-09-03", status: "approved", typeName: "Annual" },
        { userId: "ravi", startDate: "2026-09-08", endDate: "2026-09-08", status: "pending", typeName: "Annual" },
      ],
      covers: [{ truckId: "t1", date: "2026-09-03", driverId: "ravi", note: null }],
    }));
    const row = (id: string) => view.driverRows.find((r) => r.driver.userId === id)!.cells;
    expect(row("azman")[1]).toMatchObject({ state: "driving", truckCode: "JHR-01" });
    expect(row("azman")[3]).toMatchObject({ state: "leave", leaveType: "Annual" });
    expect(row("ravi")[3]).toMatchObject({ state: "cover", truckCode: "JHR-01" });
    expect(row("ravi")[1]).toMatchObject({ state: "free" });
    expect(row("ravi")[8]).toMatchObject({ state: "pending" });
    expect(row("ravi")[0]!.state).toBe("holiday");
    // Sun 6 Sep: no truck runs, but the org is open, so the driver is free
    // (spec assumption 3 - drivers have no fixed rest days in v1).
    expect(row("ravi")[6]!.state).toBe("free");
  });

  it("poolRows holds only drivers without a regular truck", () => {
    const view = buildRoster(base());
    expect(view.poolRows.map((r) => r.driver.userId)).toEqual(["ravi"]);
    expect(view.driverRows).toHaveLength(3);
  });

  it("freeByDay excludes drivers on leave or planned on a truck", () => {
    const view = buildRoster(base({ leave: [{ userId: "ravi", startDate: "2026-09-02", endDate: "2026-09-02", status: "approved", typeName: "Medical" }] }));
    expect(view.freeByDay["2026-09-01"]).toEqual(["ravi"]);
    expect(view.freeByDay["2026-09-02"]).toEqual([]);
    // Sunday: no truck operates, so every driver is free, not off.
    expect(view.freeByDay["2026-09-06"]).toEqual(["azman", "faizal", "ravi"]);
  });

  it("freeByDay keeps drivers whose leave is still pending, matching the cover ranking", () => {
    const view = buildRoster(base({ leave: [{ userId: "ravi", startDate: "2026-09-02", endDate: "2026-09-02", status: "pending", typeName: "Annual" }] }));
    expect(view.freeByDay["2026-09-02"]).toEqual(["ravi"]);
    expect(rankCoverCandidates(view, "t1", "2026-09-02").map((c) => [c.driver.userId, c.tier])).toEqual([["ravi", "free"], ["faizal", "busy"]]);
  });

  it("keeps drivers available on Sunday, so a Sunday-operating truck can be covered", () => {
    const view = buildRoster(base({
      trucks: [{ id: "t1", code: "JHR-01", name: "Batu Pahat", regularDriverId: "azman", operatingWeekdays: [0, 1, 2, 3, 4, 5, 6] }],
      leave: [{ userId: "azman", startDate: "2026-09-06", endDate: "2026-09-06", status: "approved", typeName: "Annual" }],
    }));
    const sunday = view.gaps.find((g) => g.date === "2026-09-06");
    expect(sunday).toMatchObject({ truckCode: "JHR-01", reason: { kind: "leave", driverName: "Azman" } });
    expect(sunday!.freeDriverIds).toContain("ravi");
  });

  it("gap.freeDriverIds lists that day's free drivers", () => {
    const view = buildRoster(base({ leave: [{ userId: "azman", startDate: "2026-09-03", endDate: "2026-09-03", status: "approved", typeName: "Annual" }] }));
    expect(view.gaps[0]!.freeDriverIds).toEqual(["ravi"]);
  });
});

describe("pending leave on a planned driver", () => {
  it("keeps the truck code on the driver cell, drops them from freeByDay and ranks them busy", () => {
    const view = buildRoster(base({ leave: [{ userId: "faizal", startDate: "2026-09-02", endDate: "2026-09-02", status: "pending", typeName: "Annual" }] }));
    const faizal = view.driverRows.find((r) => r.driver.userId === "faizal")!.cells.find((c) => c.date === "2026-09-02")!;
    expect(faizal).toMatchObject({ state: "pending", truckCode: "JHR-02", leaveType: "Annual" });
    expect(view.freeByDay["2026-09-02"]).toEqual(["ravi"]);
    expect(rankCoverCandidates(view, "t1", "2026-09-02").map((c) => [c.driver.userId, c.tier, c.busyTruckCode])).toEqual([
      ["ravi", "free", null],
      ["faizal", "busy", "JHR-02"],
    ]);
  });

  it("still treats an unplanned pool driver with pending leave as free", () => {
    const view = buildRoster(base({ leave: [{ userId: "ravi", startDate: "2026-09-02", endDate: "2026-09-02", status: "pending", typeName: "Annual" }] }));
    const ravi = view.driverRows.find((r) => r.driver.userId === "ravi")!.cells.find((c) => c.date === "2026-09-02")!;
    expect(ravi).toMatchObject({ state: "pending", truckCode: null });
    expect(view.freeByDay["2026-09-02"]).toEqual(["ravi"]);
  });
});

describe("rankCoverCandidates", () => {
  it("orders free pool first, then drivers whose truck is off, then busy, and drops drivers on leave", () => {
    const input = base({
      trucks: [
        { id: "t1", code: "JHR-01", name: "Batu Pahat", regularDriverId: "azman", operatingWeekdays: ALL_WEEK },
        { id: "t2", code: "JHR-02", name: "Kluang", regularDriverId: "faizal", operatingWeekdays: ALL_WEEK },
        { id: "t3", code: "JHR-03", name: "Muar", regularDriverId: "hakim", operatingWeekdays: [1, 3, 5] },
      ],
      drivers: [
        { userId: "azman", name: "Azman", regularTruckId: "t1" },
        { userId: "faizal", name: "Faizal", regularTruckId: "t2" },
        { userId: "hakim", name: "Hakim", regularTruckId: "t3" },
        { userId: "ravi", name: "Ravi", regularTruckId: null },
        { userId: "syafiq", name: "Syafiq", regularTruckId: null },
      ],
      leave: [
        { userId: "azman", startDate: "2026-09-03", endDate: "2026-09-03", status: "approved", typeName: "Annual" },
        { userId: "syafiq", startDate: "2026-09-03", endDate: "2026-09-03", status: "approved", typeName: "Annual" },
      ],
    });
    const view = buildRoster(input);
    const ranked = rankCoverCandidates(view, "t1", "2026-09-03"); // Thursday: t3 is off
    expect(ranked.map((c) => [c.driver.userId, c.tier, c.busyTruckCode])).toEqual([
      ["ravi", "free", null],
      ["hakim", "truckOff", null],
      ["faizal", "busy", "JHR-02"],
    ]);
  });
});
