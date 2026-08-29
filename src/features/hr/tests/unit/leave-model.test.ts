import { describe, expect, it } from "vitest";
import {
  accruedDays,
  computeBalance,
  earliestStartDate,
  minNoticeDays,
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

/**
 * `validateApplication` with a `today` far enough in the past that the
 * advance-notice rule never fires, so every test below pins the rule it
 * actually names. Notice has its own describe block, which passes `today`
 * explicitly.
 */
type ValidateInput = Parameters<typeof validateApplication>[0];
function validate(input: Omit<ValidateInput, "today"> & { today?: string }) {
  return validateApplication({ today: "2026-01-01", ...input });
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
// As-of convention: applying uses the LEAVE START DATE, not "today"
// ---------------------------------------------------------------------------

describe("as-of convention (asOf = startDate, not today)", () => {
  it("applying in August for December dates validates against FULL December accrual", () => {
    const type = makeType(); // Annual: 12, pro_rata
    const startDate = "2026-12-01";
    const endDate = "2026-12-02";
    const dayCount = workdayCount(startDate, endDate, []);

    // The convention under test: asOf is the request's start date (December),
    // never "today" (August) — accrued must be the full 12, not August's 8.
    const balance = computeBalance(type, [], [], 2026, startDate);
    expect(balance.accrued).toBe(12);

    const result = validate({
      type,
      startDate,
      endDate,
      dayCount,
      balance,
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: true });

    // Sanity check the bug this pins: computing against "today" (August,
    // asOf = 2026-08-29) instead would only accrue 8 — still enough for this
    // 2-day request, so pin a request size that only the correct (December)
    // accrual can cover, proving the wrong asOf would actually reject it.
    const longEndDate = "2026-12-10";
    const longDayCount = workdayCount(startDate, longEndDate, []);
    expect(longDayCount).toBe(8); // more than August's accrued 8 - 0 = 8 is exactly the boundary

    const augustAccrual = computeBalance(type, [], [], 2026, "2026-08-29");
    expect(augustAccrual.accrued).toBe(8);
    const tooManyDaysForAugust = validate({
      type,
      startDate,
      endDate: longEndDate,
      dayCount: longDayCount + 1, // one past what August's accrual could ever cover
      balance: augustAccrual,
      attachmentProvided: false,
    });
    expect(tooManyDaysForAugust).toEqual({ ok: false, reason: "insufficient_balance" });

    const decemberAccrual = computeBalance(type, [], [], 2026, startDate);
    const sameRequestAgainstDecemberAccrual = validate({
      type,
      startDate,
      endDate: longEndDate,
      dayCount: longDayCount + 1,
      balance: decemberAccrual,
      attachmentProvided: false,
    });
    expect(sameRequestAgainstDecemberAccrual).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Advance notice (annual: 7 calendar days)
// ---------------------------------------------------------------------------

describe("advance notice", () => {
  const TODAY = "2026-08-29"; // a Saturday
  const annual = makeType();
  const medical = makeType({
    id: "type-medical",
    code: "medical",
    name: "Medical",
    accrual: "full",
    entitlementDays: 14,
    carryForwardCap: null,
  });

  function noticeBalance(): BalanceSummary {
    return {
      uponRequest: false,
      entitlement: 12,
      accrued: 12,
      carryForward: 0,
      carryForwardExpiresOn: null,
      credits: 0,
      takenBase: 0,
      takenCarryForward: 0,
      pendingHeld: 0,
      available: 12,
    };
  }

  it("requires 7 days for annual and none for other types", () => {
    expect(minNoticeDays(annual)).toBe(7);
    expect(minNoticeDays(medical)).toBe(0);
  });

  it("earliestStartDate shifts by calendar days, weekends and holidays included", () => {
    // 29 Aug + 7 = 5 Sep, straight calendar arithmetic — the weekend in
    // between does not extend it, and neither would Merdeka Day on 31 Aug.
    expect(earliestStartDate(annual, TODAY)).toBe("2026-09-05");
    expect(earliestStartDate(medical, TODAY)).toBe(TODAY);
  });

  it("rejects annual leave starting inside the notice window", () => {
    for (const startDate of ["2026-08-31", "2026-09-03", "2026-09-04"]) {
      const result = validateApplication({
        type: annual,
        today: TODAY,
        startDate,
        endDate: startDate,
        dayCount: 1,
        balance: noticeBalance(),
        attachmentProvided: false,
      });
      expect(result, startDate).toEqual({ ok: false, reason: "insufficient_notice" });
    }
  });

  it("accepts annual leave starting exactly 7 days out — the boundary is inclusive", () => {
    const result = validateApplication({
      type: annual,
      today: TODAY,
      startDate: "2026-09-05",
      endDate: "2026-09-07",
      dayCount: 1,
      balance: noticeBalance(),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("still rejects a same-day annual request applied for in the past", () => {
    const result = validateApplication({
      type: annual,
      today: TODAY,
      startDate: "2026-08-20",
      endDate: "2026-08-20",
      dayCount: 1,
      balance: noticeBalance(),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: false, reason: "insufficient_notice" });
  });

  it("does not gate unplanned leave types — medical can start today", () => {
    const result = validateApplication({
      type: medical,
      today: TODAY,
      startDate: TODAY,
      endDate: TODAY,
      dayCount: 1,
      balance: noticeBalance(),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports notice before balance, so a short-notice request names the real problem", () => {
    const result = validateApplication({
      type: annual,
      today: TODAY,
      startDate: "2026-08-31",
      endDate: "2026-08-31",
      dayCount: 99, // also over balance
      balance: noticeBalance(),
      attachmentProvided: false,
    });
    expect(result).toEqual({ ok: false, reason: "insufficient_notice" });
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
    const result = validate({
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
    const result = validate({
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
    const result = validate({
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
    const result = validate({
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
    const result = validate({
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
    const result = validate({
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
