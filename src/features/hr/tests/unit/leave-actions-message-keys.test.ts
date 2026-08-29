/**
 * Key-assertion tests for `src/features/hr/server/leave-actions.ts`.
 *
 * Mirrors the mocking idiom in
 * src/features/orders/tests/unit/driver-actions-message-keys.test.ts /
 * order-actions-message-keys.test.ts: mock the guards module + Supabase
 * server client, then exercise guard-ordering and RPC-error -> messageKey
 * mapping through the exported actions. Covers applyLeave (attachment-path
 * ownership + server-side day-count recompute), requestLeaveCredit
 * (validation), and cancelMyLeaveRequest (RPC error mapping) — all under
 * the `hr.errors.*` messageKey namespace. `decideLeave`/`decideCredit` and
 * the settings mutations live in manage-actions.ts, covered by
 * manage-actions-message-keys.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../../server/guards", async () => {
  const actual = await vi.importActual<typeof import("../../server/guards")>("../../server/guards");
  return {
    OrderPermissionError: actual.OrderPermissionError,
    requireMember: vi.fn(),
  };
});

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireMember, OrderPermissionError } from "../../server/guards";
import { applyLeave, requestLeaveCredit, cancelMyLeaveRequest } from "../../server/leave-actions";
import { workdayCount } from "../../lib/leave-model";

function mockMemberGuard() {
  vi.mocked(requireMember).mockResolvedValue({
    orgId: "org-1",
    userId: "user-1",
    role: "seller",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

function mockSupabaseRpc(rpcResult: { error: { message: string } | null }) {
  const supabase = { rpc: vi.fn(() => Promise.resolve(rpcResult)) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

/**
 * A `.from(table)` mock that hands each call a queued `{ data, error }`
 * result for that table (FIFO), and records every `.insert(...)` payload —
 * needed because `applyLeave` hits `leave_types`, `public_holidays`,
 * `leave_ledger`, and `leave_requests` (twice: a select, then the insert)
 * in one call, each expecting a different shape back.
 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = { insertedWith: undefined as unknown };
  for (const method of ["select", "eq", "in", "gte", "lte", "order", "maybeSingle", "single"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.insert = vi.fn((payload: unknown) => {
    builder.insertedWith = payload;
    return builder;
  });
  builder.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabaseTables(resultsByTable: Record<string, Array<{ data: unknown; error: unknown }>>) {
  const queues = new Map(Object.entries(resultsByTable).map(([table, results]) => [table, [...results]]));
  const builders: Record<string, ReturnType<typeof makeBuilder>[]> = {};
  const supabase = {
    from: vi.fn((table: string) => {
      const queue = queues.get(table);
      const result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
      const builder = makeBuilder(result);
      (builders[table] ??= []).push(builder);
      return builder;
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return { supabase, builders };
}

/** A leave_types row shaped for the recompute tests: upon-request sidesteps balance math entirely. */
function uponRequestTypeRow() {
  return {
    id: "type-1",
    code: "annual",
    name: "Annual",
    entitlement_days: null,
    accrual: "full",
    carry_forward_cap: null,
    requires_attachment: false,
    sort: 1,
  };
}

/**
 * `applyLeave` measures the annual advance-notice rule against the org's
 * today, so these tests pin the clock — otherwise the fixture dates below
 * silently slide inside the 7-day window as the real date advances, and the
 * suite starts failing on a calendar boundary rather than on a code change.
 */
const FROZEN_NOW = new Date("2026-08-10T02:00:00Z"); // 10:00 MYT, 10 Aug 2026

const validApplyInput = {
  leaveTypeId: "type-1",
  // Comfortably past the annual notice cutoff (10 Aug + 7 = 17 Aug).
  startDate: "2026-09-01",
  endDate: "2026-09-04",
  justification: "family matters",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("guard-first (applyLeave)", () => {
  it.each([
    ["Not authenticated", "hr.errors.unauthenticated"],
    ["Organization not found", "hr.errors.orgNotFound"],
    [undefined, "hr.errors.forbidden"],
  ])("returns a forbidden-shaped err without touching supabase (%s)", async (rawMessage, expectedKey) => {
    vi.mocked(requireMember).mockRejectedValue(
      rawMessage ? new OrderPermissionError(rawMessage) : new OrderPermissionError(),
    );
    const result = await applyLeave("ayam-norliza-pilot", validApplyInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe(expectedKey);
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

describe("guard-first (requestLeaveCredit, cancelMyLeaveRequest)", () => {
  it("requestLeaveCredit returns forbidden without touching supabase", async () => {
    vi.mocked(requireMember).mockRejectedValue(new OrderPermissionError());
    const result = await requestLeaveCredit("ayam-norliza-pilot", {
      leaveTypeId: "type-1",
      amount: 1,
      referenceStart: "2026-01-01",
      referenceEnd: "2026-01-02",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("hr.errors.forbidden");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("cancelMyLeaveRequest returns forbidden without touching supabase", async () => {
    vi.mocked(requireMember).mockRejectedValue(new OrderPermissionError());
    const result = await cancelMyLeaveRequest("ayam-norliza-pilot", "request-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("hr.errors.forbidden");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

describe("cancelMyLeaveRequest RPC error mapping", () => {
  it.each([
    ["not_found", "not_found", "hr.errors.not_found"],
    ["forbidden", "forbidden", "hr.errors.forbidden"],
    ["invalid_status", "conflict", "hr.errors.invalid_status"],
    ["some_unmapped_code", "internal", "hr.errors.internal"],
  ])("maps RPC message %s to code %s / messageKey %s", async (rpcMessage, expectedCode, expectedKey) => {
    mockMemberGuard();
    const supabase = mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await cancelMyLeaveRequest("ayam-norliza-pilot", "request-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(expectedCode);
      expect(result.messageKey).toBe(expectedKey);
    }
    expect(supabase.rpc).toHaveBeenCalledWith("cancel_leave_request", { p_request: "request-1" });
  });

  it("succeeds when the RPC reports no error", async () => {
    mockMemberGuard();
    mockSupabaseRpc({ error: null });
    const result = await cancelMyLeaveRequest("ayam-norliza-pilot", "request-1");
    expect(result.ok).toBe(true);
  });
});

describe("applyLeave attachment-path ownership", () => {
  it("rejects a path not prefixed {orgId}/{userId}/ as a validation err, before touching supabase", async () => {
    mockMemberGuard();
    const result = await applyLeave("ayam-norliza-pilot", {
      ...validApplyInput,
      attachmentPath: "someone-else/not-me/file.pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("hr.errors.validation");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("accepts a path prefixed {orgId}/{userId}/", async () => {
    mockMemberGuard();
    const { builders } = mockSupabaseTables({
      leave_types: [{ data: uponRequestTypeRow(), error: null }],
      public_holidays: [{ data: [], error: null }],
      leave_ledger: [{ data: [], error: null }],
      leave_requests: [
        { data: [], error: null },
        { data: { id: "new-request" }, error: null },
      ],
    });
    const result = await applyLeave("ayam-norliza-pilot", {
      ...validApplyInput,
      attachmentPath: "org-1/user-1/receipt.pdf",
    });
    expect(result.ok).toBe(true);
    expect(builders.leave_requests![1]!.insert).toHaveBeenCalled();
  });
});

describe("applyLeave day-count recompute", () => {
  it("inserts day_count from workdayCount over the recomputed range/holidays", async () => {
    mockMemberGuard();
    const holidays = ["2026-09-02"]; // a workday inside the range, knocked out
    const { builders } = mockSupabaseTables({
      leave_types: [{ data: uponRequestTypeRow(), error: null }],
      public_holidays: [{ data: holidays.map((holiday_date) => ({ holiday_date })), error: null }],
      leave_ledger: [{ data: [], error: null }],
      leave_requests: [
        { data: [], error: null },
        { data: { id: "new-request" }, error: null },
      ],
    });

    const result = await applyLeave("ayam-norliza-pilot", validApplyInput);
    expect(result.ok).toBe(true);

    const expectedDayCount = workdayCount(validApplyInput.startDate, validApplyInput.endDate, holidays);
    const insertPayload = builders.leave_requests![1]!.insertedWith as Record<string, unknown>;
    expect(insertPayload.day_count).toBe(expectedDayCount);
    // Sanity: the holiday actually knocked a day off, so this isn't a
    // vacuous assertion against a full 4-day range (the action has no
    // client-supplied day-count field at all — it's always recomputed).
    expect(expectedDayCount).toBeLessThan(4);
  });
});

describe("applyLeave advance notice (annual: 7 calendar days)", () => {
  /**
   * The dialog's `min` on the start-date input stops this in the browser, so
   * these pin the layer underneath it: a caller that skips the UI entirely
   * still gets refused, and never reaches the insert.
   */
  it("refuses annual leave starting inside the notice window", async () => {
    mockMemberGuard();
    const { builders } = mockSupabaseTables({
      leave_types: [{ data: uponRequestTypeRow(), error: null }],
      public_holidays: [{ data: [], error: null }],
      leave_ledger: [{ data: [], error: null }],
      leave_requests: [
        { data: [], error: null },
        { data: { id: "should-never-be-inserted" }, error: null },
      ],
    });

    // Frozen today is 2026-08-10, so the cutoff is 2026-08-17.
    const result = await applyLeave("ayam-norliza-pilot", {
      ...validApplyInput,
      startDate: "2026-08-13",
      endDate: "2026-08-14",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("hr.errors.insufficient_notice");
    }
    // Only the balance-read `.from("leave_requests")` ran; validation
    // short-circuits before the insert builder is ever constructed.
    expect(builders.leave_requests).toHaveLength(1);
  });

  it("accepts annual leave starting exactly on the cutoff", async () => {
    mockMemberGuard();
    const { builders } = mockSupabaseTables({
      leave_types: [{ data: uponRequestTypeRow(), error: null }],
      public_holidays: [{ data: [], error: null }],
      leave_ledger: [{ data: [], error: null }],
      leave_requests: [
        { data: [], error: null },
        { data: { id: "new-request" }, error: null },
      ],
    });

    const result = await applyLeave("ayam-norliza-pilot", {
      ...validApplyInput,
      startDate: "2026-08-17", // 2026-08-10 + 7
      endDate: "2026-08-18",
    });

    expect(result.ok).toBe(true);
    expect(builders.leave_requests![1]!.insert).toHaveBeenCalled();
  });

  it("leaves unplanned types ungated — medical may start tomorrow", async () => {
    mockMemberGuard();
    const { builders } = mockSupabaseTables({
      leave_types: [
        { data: { ...uponRequestTypeRow(), code: "medical", name: "Medical" }, error: null },
      ],
      public_holidays: [{ data: [], error: null }],
      leave_ledger: [{ data: [], error: null }],
      leave_requests: [
        { data: [], error: null },
        { data: { id: "new-request" }, error: null },
      ],
    });

    const result = await applyLeave("ayam-norliza-pilot", {
      ...validApplyInput,
      startDate: "2026-08-11",
      endDate: "2026-08-11",
    });

    expect(result.ok).toBe(true);
    expect(builders.leave_requests![1]!.insert).toHaveBeenCalled();
  });

  it("surfaces the trigger's insufficient_notice as a validation err, not a generic failure", async () => {
    // The insert trigger re-checks the rule atomically and can reject what
    // this action just accepted — the cutoff moves when the depot clock rolls
    // past midnight between the two.
    mockMemberGuard();
    mockSupabaseTables({
      leave_types: [{ data: uponRequestTypeRow(), error: null }],
      public_holidays: [{ data: [], error: null }],
      leave_ledger: [{ data: [], error: null }],
      leave_requests: [
        { data: [], error: null },
        { data: null, error: { message: "insufficient_notice" } },
      ],
    });

    const result = await applyLeave("ayam-norliza-pilot", validApplyInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("hr.errors.insufficient_notice");
    }
  });
});

describe("requestLeaveCredit validation", () => {
  it("returns hr.errors.validation (not hr.errors.invalid_amount) for a non-positive amount", async () => {
    mockMemberGuard();
    const result = await requestLeaveCredit("ayam-norliza-pilot", {
      leaveTypeId: "type-1",
      amount: 0,
      referenceStart: "2026-01-01",
      referenceEnd: "2026-01-02",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("hr.errors.validation");
    }
  });
});
