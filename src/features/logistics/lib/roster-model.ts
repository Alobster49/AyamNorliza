/**
 * Pure roster view: trucks as rows, days as columns, one cell per (truck,
 * day) saying who drives and whether that is a problem. Everything is derived
 * from plain rows so the server action stays thin and the rules live in one
 * tested place. Dates are ISO `YYYY-MM-DD` strings in the org's time zone;
 * the caller decides what "today" is.
 *
 * Gap rule (spec, "Gap rule"):
 *   operating(T, D) = D not a holiday, not blocked (org-wide or for T),
 *                     and T has a delivery slot on weekday(D)
 *   planned(T, D)   = cover ?? run driver ?? regular driver
 *   state           = !operating -> off/holiday
 *                     planned null or planned on approved leave -> gap
 *                     planned has pending leave -> risk
 *                     planned == regular -> regular, else cover
 */

import { shiftIsoDate } from "@/lib/time/org-date";

export type RosterDay = { date: string; weekday: number; isToday: boolean; holiday: string | null; orgBlocked: boolean };
export type RosterDriver = { userId: string; name: string; regularTruckId: string | null };
export type RosterTruck = { id: string; code: string; name: string; regularDriverId: string | null; operatingWeekdays: number[] };
export type LeaveRow = { userId: string; startDate: string; endDate: string; status: "approved" | "pending"; typeName: string };
export type CoverRow = { truckId: string; date: string; driverId: string; note: string | null };
export type RunRow = { truckId: string; runDate: string; driverId: string | null };
export type BlockRow = { date: string; truckId: string | null };
export type HolidayRow = { date: string; name: string };

export type RosterInput = {
  fromDate: string;
  days: number;
  today: string;
  trucks: RosterTruck[];
  drivers: RosterDriver[];
  leave: LeaveRow[];
  covers: CoverRow[];
  runs: RunRow[];
  blocks: BlockRow[];
  holidays: HolidayRow[];
};

export type TruckCellState = "off" | "holiday" | "gap" | "risk" | "cover" | "regular";
export type TruckCell = { date: string; state: TruckCellState; driverId: string | null; driverName: string | null };
export type DriverCellState = "off" | "holiday" | "leave" | "pending" | "cover" | "driving" | "free";
export type DriverCell = { date: string; state: DriverCellState; truckCode: string | null; leaveType: string | null };

export type GapReason =
  | { kind: "no_regular" }
  | { kind: "leave"; driverName: string; leaveType: string; startDate: string; endDate: string; status: "approved" | "pending" };
export type RosterGap = { truckId: string; truckCode: string; truckName: string; date: string; reason: GapReason; freeDriverIds: string[] };

export type TruckRow = { truck: RosterTruck; regularDriver: RosterDriver | null; cells: TruckCell[] };
export type DriverRow = { driver: RosterDriver; cells: DriverCell[] };

export type RosterView = {
  days: RosterDay[];
  truckRows: TruckRow[];
  poolRows: DriverRow[];
  driverRows: DriverRow[];
  gaps: RosterGap[];
  risks: RosterGap[];
  freeByDay: Record<string, string[]>;
};

export type CoverCandidate = { driver: RosterDriver; tier: "free" | "truckOff" | "busy"; busyTruckCode: string | null };

/** 0 = Sunday, the same convention as `delivery_slots.weekday`. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function mondayOf(iso: string): string {
  const wd = weekdayOf(iso);
  const back = wd === 0 ? 6 : wd - 1;
  return shiftIsoDate(iso, -back);
}

function leaveOn(leave: LeaveRow[], userId: string, date: string, status: LeaveRow["status"]): LeaveRow | null {
  return leave.find((l) => l.userId === userId && l.status === status && l.startDate <= date && date <= l.endDate) ?? null;
}

export function buildRoster(input: RosterInput): RosterView {
  const holidayByDate = new Map(input.holidays.map((h) => [h.date, h.name]));
  const orgBlocked = new Set(input.blocks.filter((b) => b.truckId === null).map((b) => b.date));
  const truckBlocked = new Set(input.blocks.filter((b) => b.truckId !== null).map((b) => `${b.truckId}|${b.date}`));
  const coverByKey = new Map(input.covers.map((c) => [`${c.truckId}|${c.date}`, c]));
  const runByKey = new Map(input.runs.map((r) => [`${r.truckId}|${r.runDate}`, r]));
  const driverById = new Map(input.drivers.map((d) => [d.userId, d]));
  const truckByDriver = new Map(input.trucks.filter((t) => t.regularDriverId).map((t) => [t.regularDriverId as string, t]));

  const days: RosterDay[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = shiftIsoDate(input.fromDate, i);
    days.push({
      date,
      weekday: weekdayOf(date),
      isToday: date === input.today,
      holiday: holidayByDate.get(date) ?? null,
      orgBlocked: orgBlocked.has(date),
    });
  }

  // (driverId|date) -> truck the driver is planned on. Filled while building
  // truck rows; read when building driver rows and free lists.
  const plannedOn = new Map<string, RosterTruck>();
  const gaps: RosterGap[] = [];
  const risks: RosterGap[] = [];

  const truckRows: TruckRow[] = input.trucks.map((truck) => {
    const regularDriver = truck.regularDriverId ? (driverById.get(truck.regularDriverId) ?? null) : null;
    const cells: TruckCell[] = days.map((day) => {
      if (day.holiday) return { date: day.date, state: "holiday", driverId: null, driverName: null };
      const operating =
        !day.orgBlocked && !truckBlocked.has(`${truck.id}|${day.date}`) && truck.operatingWeekdays.includes(day.weekday);
      if (!operating) return { date: day.date, state: "off", driverId: null, driverName: null };

      const cover = coverByKey.get(`${truck.id}|${day.date}`);
      const run = runByKey.get(`${truck.id}|${day.date}`);
      const plannedId = cover?.driverId ?? run?.driverId ?? truck.regularDriverId ?? null;
      const planned = plannedId ? (driverById.get(plannedId) ?? null) : null;

      const absent = planned ? leaveOn(input.leave, planned.userId, day.date, "approved") : null;
      if (!planned || absent) {
        // The gap's reason names the regular driver's leave when that is the cause.
        const regularLeave = regularDriver ? leaveOn(input.leave, regularDriver.userId, day.date, "approved") : null;
        const cause = absent ?? regularLeave;
        const reason: GapReason =
          cause && (planned ?? regularDriver)
            ? { kind: "leave", driverName: (planned ?? regularDriver)!.name, leaveType: cause.typeName, startDate: cause.startDate, endDate: cause.endDate, status: "approved" }
            : { kind: "no_regular" };
        gaps.push({ truckId: truck.id, truckCode: truck.code, truckName: truck.name, date: day.date, reason, freeDriverIds: [] });
        return { date: day.date, state: "gap", driverId: null, driverName: null };
      }

      plannedOn.set(`${planned.userId}|${day.date}`, truck);
      const pending = leaveOn(input.leave, planned.userId, day.date, "pending");
      if (pending) {
        risks.push({
          truckId: truck.id, truckCode: truck.code, truckName: truck.name, date: day.date,
          reason: { kind: "leave", driverName: planned.name, leaveType: pending.typeName, startDate: pending.startDate, endDate: pending.endDate, status: "pending" },
          freeDriverIds: [],
        });
        return { date: day.date, state: "risk", driverId: planned.userId, driverName: planned.name };
      }
      const state: TruckCellState = planned.userId === truck.regularDriverId ? "regular" : "cover";
      return { date: day.date, state, driverId: planned.userId, driverName: planned.name };
    });
    return { truck, regularDriver, cells };
  });

  const driverRows: DriverRow[] = input.drivers.map((driver) => ({
    driver,
    cells: days.map((day): DriverCell => {
      if (day.holiday) return { date: day.date, state: "holiday", truckCode: null, leaveType: null };
      if (day.orgBlocked || day.weekday === 0) return { date: day.date, state: "off", truckCode: null, leaveType: null };
      const approved = leaveOn(input.leave, driver.userId, day.date, "approved");
      if (approved) return { date: day.date, state: "leave", truckCode: null, leaveType: approved.typeName };
      const pending = leaveOn(input.leave, driver.userId, day.date, "pending");
      if (pending) return { date: day.date, state: "pending", truckCode: null, leaveType: pending.typeName };
      const on = plannedOn.get(`${driver.userId}|${day.date}`);
      if (on) return { date: day.date, state: on.id === driver.regularTruckId ? "driving" : "cover", truckCode: on.code, leaveType: null };
      return { date: day.date, state: "free", truckCode: null, leaveType: null };
    }),
  }));

  const freeByDay: Record<string, string[]> = {};
  for (const day of days) {
    freeByDay[day.date] = driverRows
      .filter((r) => r.cells.find((c) => c.date === day.date)?.state === "free")
      .map((r) => r.driver.userId);
  }
  for (const g of gaps) g.freeDriverIds = freeByDay[g.date] ?? [];
  for (const r of risks) r.freeDriverIds = freeByDay[r.date] ?? [];

  const byDate = (a: RosterGap, b: RosterGap) => a.date.localeCompare(b.date) || a.truckCode.localeCompare(b.truckCode);
  gaps.sort(byDate);
  risks.sort(byDate);

  return {
    days,
    truckRows,
    poolRows: driverRows.filter((r) => r.driver.regularTruckId === null),
    driverRows,
    gaps,
    risks,
    freeByDay,
  };
}

/**
 * Who could take `truckId` on `date`: free drivers first (cover pool before
 * regulars whose own truck happens to be free), then drivers whose own truck
 * is not running that day, then drivers already planned elsewhere (with the
 * truck they would leave uncovered). Drivers on approved leave are excluded.
 */
export function rankCoverCandidates(view: RosterView, truckId: string, date: string): CoverCandidate[] {
  const out: CoverCandidate[] = [];
  for (const row of view.driverRows) {
    const cell = row.cells.find((c) => c.date === date);
    if (!cell || cell.state === "leave" || cell.state === "holiday" || cell.state === "off") continue;
    if (cell.state === "free" || cell.state === "pending") {
      out.push({ driver: row.driver, tier: "free", busyTruckCode: null });
      continue;
    }
    if (cell.truckCode && cell.truckCode !== view.truckRows.find((t) => t.truck.id === truckId)?.truck.code) {
      out.push({ driver: row.driver, tier: "busy", busyTruckCode: cell.truckCode });
    }
  }
  // Drivers whose regular truck is off that day show up as "free" above; the
  // spec wants them ranked after the true cover pool, so re-tier them.
  for (const c of out) {
    if (c.tier === "free" && c.driver.regularTruckId) {
      const truckRow = view.truckRows.find((t) => t.truck.id === c.driver.regularTruckId);
      const own = truckRow?.cells.find((x) => x.date === date);
      if (own && (own.state === "off" || own.state === "holiday")) c.tier = "truckOff";
    }
  }
  const order = { free: 0, truckOff: 1, busy: 2 } as const;
  return out.sort((a, b) => order[a.tier] - order[b.tier] || a.driver.name.localeCompare(b.driver.name));
}
