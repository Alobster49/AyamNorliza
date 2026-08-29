import { describe, expect, it } from "vitest";
import {
  accruedDays,
  computeBalance,
  validateApplication,
  workdayCount,
} from "../../lib/leave-model";
import type { BalanceSummary, LeaveRequestSummary, LeaveTypeInfo, LedgerEntry } from "../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let uuidCounter = 0;
function uuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

function makeType(overrides: Partial<LeaveTypeInfo> = {}): LeaveTypeInfo {
  return {
    id: "type-annual",
    code: "annual",
    name: "Annual",
    entitlementDays: 12,
    accrual: "pro_rata",
    carryForwardCap: 6,
    requiresAttachment: false,
    sort: 1,
    ...overrides,
  };
}

function makeLedger(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    leaveTypeId: "type-annual",
    year: 2026,
    kind: "carry_forward",
    days: 6,
    expiresOn: "2026-10-31",
    ...overrides,
  };
}

function makeRequest(overrides: Partial<LeaveRequestSummary> = {}): LeaveRequestSummary {
  return {
    id: uuid(),
    leaveTypeId: "type-annual",
    year: 2026,
    startDate: "2026-08-24",
    endDate: "2026-08-24",
    dayCount: 1,
    status: "pending",
    breakdown: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// accruedDays
// ---------------------------------------------------------------------------

describe("accruedDays", () => {
  it("pro-rata: Annual 12 at 2026-08-29 -> 8.00", () => {
    expect(accruedDays(makeType(), "2026-08-29")).toBe(8);
  });

  it("pro-rata: at 2026-01-15 -> 1.00; at 2026-12-01 -> 12.00", () => {
    expect(accruedDays(makeType(), "2026-01-15")).toBe(1);
    expect(accruedDays(makeType(), "2026-12-01")).toBe(12);
  });

  it("full: Medical 14 available in full from 2026-01-02", () => {
    const medical = makeType({
      id: "type-medical",
      code: "medical",
      name: "Medical",
      entitlementDays: 14,
      accrual: "full",
      carryForwardCap: null,
      requiresAttachment: true,
    });
    expect(accruedDays(medical, "2026-01-02")).toBe(14);
  });

  it("upon-request: accrued 0", () => {
    const emergency = makeType({
      id: "type-emergency",
      code: "emergency",
      name: "Emergency",
      entitlementDays: null,
      accrual: "full",
      carryForwardCap: null,
    });
    expect(accruedDays(emergency, "2026-08-29")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// workdayCount
// ---------------------------------------------------------------------------

describe("workdayCount", () => {
  it("Tue..Fri no holidays -> 4", () => {
    expect(workdayCount("2026-03-24", "2026-03-27", [])).toBe(4);
  });

  it("Mon..Sun -> 5 (weekend excluded)", () => {
    expect(workdayCount("2026-03-23", "2026-03-29", [])).toBe(5);
  });

  it("range containing a holiday on a weekday subtracts it", () => {
    expect(workdayCount("2026-03-23", "2026-03-27", ["2026-03-25"])).toBe(4);
  });

  it("holiday on Saturday changes nothing", () => {
    expect(workdayCount("2026-03-23", "2026-03-29", ["2026-03-28"])).toBe(5);
  });

  it("single Sunday -> 0", () => {
    expect(workdayCount("2026-03-29", "2026-03-29", [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeBalance
// ---------------------------------------------------------------------------

describe("computeBalance", () => {
  it("mirrors screenshot 1: CF 6 + accrued 8 - taken 4 = 10, all 4 taken from CF", () => {
    const type = makeType();
    const ledger = [makeLedger()];
    const requests = [
      makeRequest({
        status: "approved",
        dayCount: 4,
        breakdown: { carryForwardUsed: 4, baseUsed: 0 },
      }),
    ];
    const balance = computeBalance(type, ledger, requests, 2026, "2026-08-29");
    expect(balance.uponRequest).toBe(false);
    expect(balance.entitlement).toBe(12);
    expect(balance.accrued).toBe(8);
    expect(balance.carryForward).toBe(6);
    expect(balance.takenCarryForward).toBe(4);
    expect(balance.takenBase).toBe(0);
    expect(balance.pendingHeld).toBe(0);
    expect(balance.available).toBe(10);
  });

  it("carry-forward consumed before base (breakdown sums, not recomputed)", () => {
    const type = makeType();
    const ledger = [makeLedger({ days: 6 })];
    const requests = [
      makeRequest({
        status: "approved",
        dayCount: 9,
        breakdown: { carryForwardUsed: 6, baseUsed: 3 },
      }),
    ];
    const balance = computeBalance(type, ledger, requests, 2026, "2026-08-29");
    // CF 6 - takenCF 6 = 0 (floored at 0); accrued 8 - takenBase 3 = 5
    expect(balance.takenCarryForward).toBe(6);
    expect(balance.takenBase).toBe(3);
    expect(balance.available).toBe(5);
  });

  it("CF expired at asOf: granted CF excluded from available, takenCF unchanged", () => {
    const type = makeType();
    const ledger = [makeLedger({ days: 6, expiresOn: "2026-05-01" })];
    const requests = [
      makeRequest({
        status: "approved",
        dayCount: 2,
        breakdown: { carryForwardUsed: 2, baseUsed: 0 },
      }),
    ];
    // asOf (Aug 29) is after the CF's expiry (May 1) -> CF excluded from grant sum,
    // but the historical carryForwardUsed on the approved request is untouched.
    const balance = computeBalance(type, ledger, requests, 2026, "2026-08-29");
    expect(balance.carryForward).toBe(0);
    expect(balance.takenCarryForward).toBe(2);
    // max(0 - 2, 0) + 8 - 0 - 0 = 8
    expect(balance.available).toBe(8);
  });

  it("pending requests hold balance", () => {
    const type = makeType();
    const ledger: LedgerEntry[] = [];
    const requests = [makeRequest({ status: "pending", dayCount: 3 })];
    const balance = computeBalance(type, ledger, requests, 2026, "2026-08-29");
    expect(balance.pendingHeld).toBe(3);
    // 0 (no CF) + 8 accrued + 0 credits - 0 taken - 3 pending = 5
    expect(balance.available).toBe(5);
  });

  it("credits add to available until their expiry", () => {
    const type = makeType();
    const ledger = [
      makeLedger({ kind: "credit", days: 2, expiresOn: "2026-12-31" }),
      makeLedger({ kind: "adjustment", days: 1, expiresOn: "2026-12-31" }),
      // Expired credit at asOf must be excluded.
      makeLedger({ kind: "credit", days: 5, expiresOn: "2026-01-01" }),
    ];
    const balance = computeBalance(type, ledger, [], 2026, "2026-08-29");
    expect(balance.credits).toBe(3);
    // 0 CF + 8 accrued + 3 credits - 0 - 0 = 11
    expect(balance.available).toBe(11);
  });

  it("upon-request type: available Infinity", () => {
    const emergency = makeType({
      id: "type-emergency",
      code: "emergency",
      entitlementDays: null,
      carryForwardCap: null,
    });
    const balance = computeBalance(emergency, [], [], 2026, "2026-08-29");
    expect(balance.uponRequest).toBe(true);
    expect(balance.entitlement).toBe(0);
    expect(balance.accrued).toBe(0);
    expect(balance.available).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// validateApplication
// ---------------------------------------------------------------------------

describe("validateApplication", () => {
  function baseBalance(overrides: Partial<BalanceSummary> = {}): BalanceSummary {
    return {
      uponRequest: false,
      entitlement: 12,
      accrued: 8,
      carryForward: 6,
      carryForwardExpiresOn: "2026-10-31",
      credits: 0,
      takenBase: 0,
      takenCarryForward: 0,
      pendingHeld: 0,
      available: 10,
      ...overrides,
    };
  }

  it("rejects end < start", () => {
    const result = validateApplication({
      type: makeType(),
      startDate: "2026-08-29",
      endDate: "2026-08-28",
      dayCount: 1,
      balance: baseBalance(),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_range" });
  });

  it("rejects zero workdays", () => {
    const result = validateApplication({
      type: makeType(),
      startDate: "2026-08-29",
      endDate: "2026-08-30",
      dayCount: 0,
      balance: baseBalance(),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: false, reason: "zero_workdays" });
  });

  it("rejects over-balance requests", () => {
    const result = validateApplication({
      type: makeType(),
      startDate: "2026-08-24",
      endDate: "2026-09-04",
      dayCount: 11,
      balance: baseBalance({ available: 10 }),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: false, reason: "insufficient_balance" });
  });

  it("requires attachment when type demands it", () => {
    const medical = makeType({
      id: "type-medical",
      code: "medical",
      accrual: "full",
      entitlementDays: 14,
      carryForwardCap: null,
      requiresAttachment: true,
    });
    const result = validateApplication({
      type: medical,
      startDate: "2026-08-24",
      endDate: "2026-08-24",
      dayCount: 1,
      balance: baseBalance({ available: 14 }),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: false, reason: "attachment_required" });
  });

  it("accepts a valid in-balance application", () => {
    const result = validateApplication({
      type: makeType(),
      startDate: "2026-08-24",
      endDate: "2026-08-24",
      dayCount: 1,
      balance: baseBalance(),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("skips the balance check for upon-request types", () => {
    const emergency = makeType({
      id: "type-emergency",
      code: "emergency",
      entitlementDays: null,
      carryForwardCap: null,
    });
    const result = validateApplication({
      type: emergency,
      startDate: "2026-08-24",
      endDate: "2026-08-24",
      dayCount: 1,
      balance: { ...baseBalance(), uponRequest: true, available: Infinity },
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: true });
  });
});
