/**
 * Key-assertion tests for `src/features/orders/server/driver-actions.ts`.
 *
 * `getDriverRun` is the action consumed by the Task 5-converted
 * `/drive/[organizationSlug]/page.tsx`. `arriveStop`/`deliverStop`/`failStop`
 * were prose-only pending `driver-deck.tsx`'s own conversion (Task 3 of the
 * Phase 3 seller clean-file batch); now that driver-deck.tsx is converted,
 * these three cover the `errors.drive.stop.*` messageKey they hand back.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../../server/guards", async () => {
  const actual = await vi.importActual<typeof import("../../server/guards")>("../../server/guards");
  return {
    OrderPermissionError: actual.OrderPermissionError,
    requireOrgRole: vi.fn(),
  };
});

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "../../server/guards";
import {
  getDriverRun,
  arriveStop,
  deliverStop,
  failStop,
  startRun,
  finishRun,
  getDriverInvoice,
} from "../../server/driver-actions";

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockSupabase(runsResult: { data: unknown; error: unknown } = { data: [], error: null }) {
  const supabase = { from: vi.fn(() => chain(runsResult)) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

function mockSupabaseRpc(rpcResult: { error: { message: string } | null }) {
  const supabase = { rpc: vi.fn(() => Promise.resolve(rpcResult)) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

function mockDriverGuard() {
  vi.mocked(requireOrgRole).mockResolvedValue({
    orgId: "org-1",
    userId: "user-1",
    role: "driver",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDriverRun", () => {
  it("returns drive.run.unauthenticated when the caller isn't signed in", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError("Not authenticated"));
    const result = await getDriverRun("ayam-norliza-pilot");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.unauthenticated");
  });

  it("returns drive.run.orgNotFound when the org slug doesn't resolve", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError("Organization not found"));
    const result = await getDriverRun("no-such-org");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.orgNotFound");
  });

  it("returns drive.run.forbidden for the generic permission-denied case", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError());
    const result = await getDriverRun("ayam-norliza-pilot");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.forbidden");
  });

  it("returns drive.run.internal for an unexpected guard failure", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new Error("boom"));
    const result = await getDriverRun("ayam-norliza-pilot");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.internal");
  });

  it("returns drive.run.loadFailed when the runs query errors", async () => {
    vi.mocked(requireOrgRole).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "driver", timeZone: "Asia/Kuala_Lumpur" });
    mockSupabase({ data: null, error: { message: "db down" } });
    const result = await getDriverRun("ayam-norliza-pilot");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.loadFailed");
  });

  it("succeeds with no run and no messageKey when there's nothing to open", async () => {
    vi.mocked(requireOrgRole).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "driver", timeZone: "Asia/Kuala_Lumpur" });
    mockSupabase({ data: [], error: null });
    const result = await getDriverRun("ayam-norliza-pilot");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.run).toBeNull();
  });
});

describe("arriveStop", () => {
  it("returns drive.run.forbidden when the guard rejects the caller", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError());
    const result = await arriveStop("ayam-norliza-pilot", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.forbidden");
  });

  it("returns drive.stop.forbidden when the RPC rejects the record (not this driver's stop)", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "forbidden" } });
    const result = await arriveStop("ayam-norliza-pilot", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.forbidden");
  });

  it("returns drive.stop.notDeparted when the run hasn't left the yard", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "run_not_departed" } });
    const result = await arriveStop("ayam-norliza-pilot", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.notDeparted");
  });

  it("returns drive.stop.internal for an unmapped RPC error code", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "not_found" } });
    const result = await arriveStop("ayam-norliza-pilot", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.internal");
  });
});

describe("deliverStop", () => {
  it("returns drive.stop.invalidAmount without calling the RPC when cash is negative", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await deliverStop("ayam-norliza-pilot", "order-1", {
      cashCollected: -5,
      lines: [{ itemId: "item-1", finalWeightKg: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidAmount");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns drive.stop.invalidAmount when the RPC rejects the cash amount", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_amount" } });
    const result = await deliverStop("ayam-norliza-pilot", "order-1", {
      cashCollected: 10,
      lines: [{ itemId: "item-1", finalWeightKg: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidAmount");
  });

  it("returns drive.stop.invalidStatus when the order is already resolved", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_status" } });
    const result = await deliverStop("ayam-norliza-pilot", "order-1", {
      lines: [{ itemId: "item-1", finalWeightKg: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidStatus");
  });

  it("returns drive.run.orgNotFound when the guard can't resolve the org", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError("Organization not found"));
    const result = await deliverStop("no-such-org", "order-1", {
      lines: [{ itemId: "item-1", finalWeightKg: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.orgNotFound");
  });
});

describe("failStop", () => {
  it("returns drive.stop.invalidStatus when the order is already resolved", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_status" } });
    const result = await failStop("ayam-norliza-pilot", "order-1", "shop_closed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidStatus");
  });

  it("returns drive.stop.forbidden when the RPC rejects the record", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "forbidden" } });
    const result = await failStop("ayam-norliza-pilot", "order-1", "wrong_address");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.forbidden");
  });

  it("returns drive.run.internal for an unexpected guard failure", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new Error("boom"));
    const result = await failStop("ayam-norliza-pilot", "order-1", "other");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.internal");
  });
});

describe("startRun", () => {
  it("maps invalid_transition to errors.drive.run.alreadyStarted", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_transition" } });
    const result = await startRun("org-slug", "run-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.alreadyStarted");
  });

  it("calls driver_start_run and succeeds", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await startRun("org-slug", "run-1");
    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("driver_start_run", { p_run: "run-1" });
  });
});

describe("finishRun", () => {
  it("maps invalid_transition to errors.drive.run.notDeparted", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_transition" } });
    const result = await finishRun("org-slug", "run-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.notDeparted");
  });

  it("maps forbidden to errors.drive.run.forbidden", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "forbidden" } });
    const result = await finishRun("org-slug", "run-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.forbidden");
  });

  it("calls driver_finish_run and succeeds", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await finishRun("org-slug", "run-1");
    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("driver_finish_run", { p_run: "run-1" });
  });
});

describe("deliverStop weights", () => {
  it("rejects an empty lines array before calling the RPC", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await deliverStop("org-slug", "order-1", { lines: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.weightsMissing");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-positive weight before calling the RPC", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await deliverStop("org-slug", "order-1", {
      lines: [{ itemId: "item-1", finalWeightKg: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidWeight");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("passes snake_case lines to driver_deliver_stop", async () => {
    mockDriverGuard();
    const supabase = mockSupabaseRpc({ error: null });
    const result = await deliverStop("org-slug", "order-1", {
      cashCollected: 50,
      lines: [{ itemId: "item-1", finalWeightKg: 2.35, finalPieces: 2 }],
    });
    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("driver_deliver_stop", {
      p_order: "order-1",
      p_received_by: null,
      p_signature_path: null,
      p_photo_path: null,
      p_cash_collected: 50,
      p_lines: [{ item_id: "item-1", final_weight_kg: 2.35, final_pieces: 2 }],
    });
  });

  it("maps invalid_weight RPC error to errors.drive.stop.invalidWeight", async () => {
    mockDriverGuard();
    mockSupabaseRpc({ error: { message: "invalid_weight" } });
    const result = await deliverStop("org-slug", "order-1", {
      lines: [{ itemId: "item-1", finalWeightKg: 2 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.stop.invalidWeight");
  });
});

describe("getDriverInvoice", () => {
  it("returns forbidden messageKey when the guard rejects", async () => {
    vi.mocked(requireOrgRole).mockRejectedValue(new OrderPermissionError("Not authenticated"));
    const result = await getDriverInvoice("org-slug", "order-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.drive.run.unauthenticated");
  });
});
