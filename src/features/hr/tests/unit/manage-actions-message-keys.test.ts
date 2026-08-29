/**
 * Key-assertion tests for `src/features/hr/server/manage-actions.ts`.
 *
 * Same mocking idiom as leave-actions-message-keys.test.ts (itself mirroring
 * the orders precedent): mock the guards module + Supabase server client,
 * then exercise guard-ordering and RPC-error -> messageKey mapping through
 * the exported actions. Covers decideLeave (approve + reject),
 * decideCredit (approve + reject), and the settings mutations
 * deleteHoliday/updateLeaveType, which now return an honest `not_found`
 * when the row-scoping `.eq()` filters match nothing (a mutation across
 * another org's row, or an already-deleted id, previously reported success).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../../server/guards", async () => {
  const actual = await vi.importActual<typeof import("../../server/guards")>("../../server/guards");
  return {
    OrderPermissionError: actual.OrderPermissionError,
    requireLeaveApprover: vi.fn(),
  };
});

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLeaveApprover, OrderPermissionError } from "../../server/guards";
import { decideLeave, decideCredit, deleteHoliday, updateLeaveType } from "../../server/manage-actions";

function mockApproverGuard() {
  vi.mocked(requireLeaveApprover).mockResolvedValue({
    orgId: "org-1",
    userId: "approver-1",
    role: "hr",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

function mockSupabaseRpc(rpcResult: { data?: unknown; error: { message: string } | null }) {
  const supabase = { rpc: vi.fn(() => Promise.resolve(rpcResult)) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

/** Chain builder for `.from(table).delete()/.update()...eq()...select()` mutations. */
function makeMutationBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["delete", "update", "eq", "select"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabaseFrom(result: { data: unknown; error: unknown }) {
  const supabase = { from: vi.fn(() => makeMutationBuilder(result)) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const rpcErrorCases: Array<[string, string, string]> = [
  ["not_found", "not_found", "hr.errors.not_found"],
  ["forbidden", "forbidden", "hr.errors.forbidden"],
  ["invalid_status", "conflict", "hr.errors.invalid_status"],
  ["insufficient_balance", "conflict", "hr.errors.insufficient_balance"],
  ["some_unmapped_code", "internal", "hr.errors.internal"],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guard-first (decideLeave, decideCredit, deleteHoliday, updateLeaveType)", () => {
  it("decideLeave returns forbidden without touching supabase", async () => {
    vi.mocked(requireLeaveApprover).mockRejectedValue(new OrderPermissionError());
    const result = await decideLeave("ayam-norliza-pilot", "request-1", "approve");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("hr.errors.forbidden");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("decideCredit returns forbidden without touching supabase", async () => {
    vi.mocked(requireLeaveApprover).mockRejectedValue(new OrderPermissionError("Not authenticated"));
    const result = await decideCredit("ayam-norliza-pilot", "request-1", "reject");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("hr.errors.unauthenticated");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("deleteHoliday returns forbidden without touching supabase", async () => {
    vi.mocked(requireLeaveApprover).mockRejectedValue(new OrderPermissionError("Organization not found"));
    const result = await deleteHoliday("no-such-org", "holiday-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("hr.errors.orgNotFound");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("updateLeaveType returns forbidden without touching supabase", async () => {
    vi.mocked(requireLeaveApprover).mockRejectedValue(new OrderPermissionError());
    const result = await updateLeaveType("ayam-norliza-pilot", "type-1", {
      entitlementDays: 12,
      carryForwardCap: 6,
      requiresAttachment: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("hr.errors.forbidden");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

describe("decideLeave RPC error mapping", () => {
  it.each(rpcErrorCases)("approve: maps RPC message %s to code %s / messageKey %s", async (rpcMessage, expectedCode, expectedKey) => {
    mockApproverGuard();
    const supabase = mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await decideLeave("ayam-norliza-pilot", "request-1", "approve", "note");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(expectedCode);
      expect(result.messageKey).toBe(expectedKey);
    }
    expect(supabase.rpc).toHaveBeenCalledWith("approve_leave_request", { p_request: "request-1", p_note: "note" });
  });

  it.each(rpcErrorCases)("reject: maps RPC message %s to code %s / messageKey %s", async (rpcMessage, expectedCode, expectedKey) => {
    mockApproverGuard();
    const supabase = mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await decideLeave("ayam-norliza-pilot", "request-1", "reject");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(expectedCode);
      expect(result.messageKey).toBe(expectedKey);
    }
    expect(supabase.rpc).toHaveBeenCalledWith("reject_leave_request", { p_request: "request-1", p_note: null });
  });

  it("succeeds when the RPC reports no error", async () => {
    mockApproverGuard();
    mockSupabaseRpc({ error: null });
    const result = await decideLeave("ayam-norliza-pilot", "request-1", "approve");
    expect(result.ok).toBe(true);
  });
});

describe("decideCredit RPC error mapping", () => {
  it.each(rpcErrorCases)("approve: maps RPC message %s to code %s / messageKey %s", async (rpcMessage, expectedCode, expectedKey) => {
    mockApproverGuard();
    const supabase = mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await decideCredit("ayam-norliza-pilot", "credit-1", "approve");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(expectedCode);
      expect(result.messageKey).toBe(expectedKey);
    }
    expect(supabase.rpc).toHaveBeenCalledWith("approve_leave_credit", { p_request: "credit-1", p_note: null });
  });

  it.each(rpcErrorCases)("reject: maps RPC message %s to code %s / messageKey %s", async (rpcMessage, expectedCode, expectedKey) => {
    mockApproverGuard();
    const supabase = mockSupabaseRpc({ error: { message: rpcMessage } });
    const result = await decideCredit("ayam-norliza-pilot", "credit-1", "reject");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(expectedCode);
      expect(result.messageKey).toBe(expectedKey);
    }
    expect(supabase.rpc).toHaveBeenCalledWith("reject_leave_credit", { p_request: "credit-1", p_note: null });
  });
});

describe("deleteHoliday not_found on a no-op delete", () => {
  it("returns hr.errors.not_found when the delete's .eq() filters match no row", async () => {
    mockApproverGuard();
    mockSupabaseFrom({ data: [], error: null });
    const result = await deleteHoliday("ayam-norliza-pilot", "holiday-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
      expect(result.messageKey).toBe("hr.errors.not_found");
    }
  });

  it("succeeds when a row was actually deleted", async () => {
    mockApproverGuard();
    mockSupabaseFrom({ data: [{ id: "holiday-1" }], error: null });
    const result = await deleteHoliday("ayam-norliza-pilot", "holiday-1");
    expect(result.ok).toBe(true);
  });
});

describe("updateLeaveType not_found on a no-op update", () => {
  const validInput = { entitlementDays: 12, carryForwardCap: 6, requiresAttachment: false };

  it("returns hr.errors.not_found when the update's .eq() filters match no row", async () => {
    mockApproverGuard();
    mockSupabaseFrom({ data: [], error: null });
    const result = await updateLeaveType("ayam-norliza-pilot", "type-1", validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
      expect(result.messageKey).toBe("hr.errors.not_found");
    }
  });

  it("succeeds when a row was actually updated", async () => {
    mockApproverGuard();
    mockSupabaseFrom({ data: [{ id: "type-1" }], error: null });
    const result = await updateLeaveType("ayam-norliza-pilot", "type-1", validInput);
    expect(result.ok).toBe(true);
  });

  it("returns validation err (no supabase call) for a negative entitlement", async () => {
    mockApproverGuard();
    const result = await updateLeaveType("ayam-norliza-pilot", "type-1", {
      ...validInput,
      entitlementDays: -1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("hr.errors.validation");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});
