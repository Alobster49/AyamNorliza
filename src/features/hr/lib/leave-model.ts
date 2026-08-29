/**
 * Pure model for the HR leave engine: accrual, workday counting, and
 * carry-forward-first balance computation. This is what the UI shows;
 * the SQL RPCs (supabase/migrations/20260830000002_hr_leave_rpcs.sql) are
 * the source of truth and re-check everything atomically at decision time.
 * No React, no DOM — unit tested in tests/unit/leave-model.test.ts.
 *
 * Rules mirror leave_available in the SQL twin exactly — divergence is a bug:
 * - pro_rata accrual: round(entitlement * calendar-month(asOf) / 12, 2), Jan=1.
 * - full accrual: entitlement, unaffected by asOf.
 * - upon-request (entitlementDays null): unlimited (Infinity available).
 * - available = max(CF - takenCF, 0) + accrued + credits - takenBase - pendingHeld.
 *
 * As-of convention: for applying/validating a request, `asOf` is the LEAVE
 * START DATE, not "today" — a December request must be checked against
 * December's full accrual, not however much has accrued by the day the
 * member happens to apply. `approve_leave_request` in the SQL twin enforces
 * this the same way (calls `leave_available` with `r.start_date`). The one
 * deliberate exception is the HR staff-balances table (manage-actions.ts),
 * which asks "what is this member's balance right now" and uses today.
 */

import { eachDayOfInterval, format, getMonth, isWeekend, parseISO } from "date-fns";
import type { BalanceSummary, LeaveRequestSummary, LeaveTypeInfo, LedgerEntry } from "../types";

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/** Matches Postgres `round(numeric, 2)` for the non-negative values this module deals with. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Accrual
// ---------------------------------------------------------------------------

/**
 * Calendar month number of an ISO date string, 1-based (Jan = 1). Uses
 * date-fns `parseISO` on the bare date — safe against the UTC-vs-local
 * footgun of `new Date("2026-08-29")`, which the platform parses as UTC
 * midnight and can therefore land on the previous local day.
 */
function monthIndex(asOf: string): number {
  return getMonth(parseISO(asOf)) + 1;
}

export function accruedDays(type: LeaveTypeInfo, asOf: string): number {
  if (type.entitlementDays === null) return 0; // upon-request
  if (type.accrual === "pro_rata") {
    return round2((type.entitlementDays * monthIndex(asOf)) / 12);
  }
  return type.entitlementDays;
}

// ---------------------------------------------------------------------------
// Workday counting
// ---------------------------------------------------------------------------

/**
 * Inclusive Mon–Fri count between startDate and endDate, minus any holiday
 * (from `holidays`, ISO date strings) that falls on a counted weekday. A
 * holiday on a weekend has no effect, since weekends are already excluded.
 */
export function workdayCount(startDate: string, endDate: string, holidays: string[]): number {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (start > end) return 0;
  const holidaySet = new Set(holidays);
  return eachDayOfInterval({ start, end }).reduce((count, day) => {
    if (isWeekend(day)) return count;
    if (holidaySet.has(format(day, "yyyy-MM-dd"))) return count;
    return count + 1;
  }, 0);
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

/** expiresOn === null never expires; otherwise unexpired means expiresOn >= asOf (ISO dates compare lexically). */
function isUnexpired(expiresOn: string | null, asOf: string): boolean {
  return expiresOn === null || expiresOn >= asOf;
}

export function computeBalance(
  type: LeaveTypeInfo,
  ledger: LedgerEntry[],
  requests: LeaveRequestSummary[],
  year: number,
  asOf: string,
): BalanceSummary {
  if (type.entitlementDays === null) {
    // Upon-request: no balance is tracked at all. Infinity is a client-side
    // convenience for comparisons/display (e.g. `available > dayCount`) —
    // this value is never persisted or serialized to JSON (JSON.stringify
    // turns it into `null`), so it must not cross a network boundary.
    return {
      uponRequest: true,
      entitlement: 0,
      accrued: 0,
      carryForward: 0,
      carryForwardExpiresOn: null,
      credits: 0,
      takenBase: 0,
      takenCarryForward: 0,
      pendingHeld: 0,
      available: Infinity,
    };
  }

  const accrued = accruedDays(type, asOf);

  const relevantLedger = ledger.filter(
    (entry) =>
      entry.leaveTypeId === type.id && entry.year === year && isUnexpired(entry.expiresOn, asOf),
  );
  const cfEntries = relevantLedger.filter((entry) => entry.kind === "carry_forward");
  const carryForward = round2(cfEntries.reduce((sum, entry) => sum + entry.days, 0));
  const carryForwardExpiresOn = cfEntries[0]?.expiresOn ?? null;
  const credits = round2(
    relevantLedger
      .filter((entry) => entry.kind === "credit" || entry.kind === "adjustment")
      .reduce((sum, entry) => sum + entry.days, 0),
  );

  // CF-first split comes from the stored breakdown on each approved request
  // (set once, at approval time, by approve_leave_request) — never
  // recomputed here, since re-deriving it from a possibly-since-changed CF
  // balance would rewrite history.
  const approved = requests.filter(
    (r) => r.leaveTypeId === type.id && r.year === year && r.status === "approved",
  );
  const takenCarryForward = round2(
    approved.reduce((sum, r) => sum + (r.breakdown?.carryForwardUsed ?? 0), 0),
  );
  const takenBase = round2(approved.reduce((sum, r) => sum + (r.breakdown?.baseUsed ?? 0), 0));

  const pendingHeld = round2(
    requests
      .filter((r) => r.leaveTypeId === type.id && r.year === year && r.status === "pending")
      .reduce((sum, r) => sum + r.dayCount, 0),
  );

  const available = round2(
    Math.max(carryForward - takenCarryForward, 0) + accrued + credits - takenBase - pendingHeld,
  );

  return {
    uponRequest: false,
    entitlement: type.entitlementDays,
    accrued,
    carryForward,
    carryForwardExpiresOn,
    credits,
    takenBase,
    takenCarryForward,
    pendingHeld,
    available,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateApplication(input: {
  type: LeaveTypeInfo;
  startDate: string;
  endDate: string;
  dayCount: number;
  balance: BalanceSummary;
  attachmentProvided: boolean;
}):
  | { ok: true }
  | { ok: false; reason: "invalid_range" | "zero_workdays" | "insufficient_balance" | "attachment_required" } {
  if (input.endDate < input.startDate) return { ok: false, reason: "invalid_range" };
  if (input.dayCount <= 0) return { ok: false, reason: "zero_workdays" };
  if (input.type.requiresAttachment && !input.attachmentProvided) {
    return { ok: false, reason: "attachment_required" };
  }
  if (!input.balance.uponRequest && input.dayCount > input.balance.available) {
    return { ok: false, reason: "insufficient_balance" };
  }
  return { ok: true };
}
