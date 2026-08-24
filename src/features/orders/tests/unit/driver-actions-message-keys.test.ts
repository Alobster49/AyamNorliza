/**
 * Key-assertion tests for `getDriverRun` in
 * `src/features/orders/server/driver-actions.ts` — the one action in this
 * file consumed by a Task 5-converted surface (`/drive/[organizationSlug]/page.tsx`).
 * `arriveStop`/`deliverStop`/`failStop` stay prose-only: their only consumer,
 * `driver-deck.tsx`, is untouched Phase 3 scope (see the SCOPE CARE note in
 * the Task 5 brief), so they're intentionally not covered here.
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
import { getDriverRun } from "../../server/driver-actions";

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
