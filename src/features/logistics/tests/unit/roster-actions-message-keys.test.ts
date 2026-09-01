import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/auth/require-permission", () => ({
  requirePermission: vi.fn(),
  resolvePermissionsForOrg: vi.fn(),
  messageForDenial: (reason: "unauthenticated" | "org_not_found" | null) => {
    if (reason === "unauthenticated") return "Not authenticated";
    if (reason === "org_not_found") return "Organization not found";
    return "Not permitted";
  },
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission, resolvePermissionsForOrg } from "@/lib/auth/require-permission";
import type { PermissionKey } from "@/lib/auth/rbac";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { assignCover, clearCover, getDriverRoster, setRegularDriver } from "../../server/roster-actions";

const CTX = { orgId: "org", userId: "u", roleId: "r", roleKey: "seller", timeZone: "Asia/Kuala_Lumpur" };

function resolvedWithViewGrant() {
  return { context: CTX, grants: new Set<PermissionKey>(["driver_roster:view", "driver_roster:edit"]), reason: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guards", () => {
  it("getDriverRoster maps a permission error to the roster forbidden key", async () => {
    vi.mocked(resolvePermissionsForOrg).mockResolvedValue({ context: null, grants: new Set(), reason: null });
    const result = await getDriverRoster("ayam-norliza-pilot", "2026-08-31", 14);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("errors.logistics.roster.forbidden");
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("getDriverRoster maps an unauthenticated denial to the roster unauthenticated key", async () => {
    vi.mocked(resolvePermissionsForOrg).mockResolvedValue({ context: null, grants: new Set(), reason: "unauthenticated" });
    const result = await getDriverRoster("ayam-norliza-pilot", "2026-08-31", 14);
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.unauthenticated");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("getDriverRoster maps an org-not-found denial to the roster orgNotFound key", async () => {
    vi.mocked(resolvePermissionsForOrg).mockResolvedValue({ context: null, grants: new Set(), reason: "org_not_found" });
    const result = await getDriverRoster("ayam-norliza-pilot", "2026-08-31", 14);
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.orgNotFound");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("maps 'Not authenticated' and 'Organization not found'", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new OrderPermissionError("Not authenticated"));
    const a = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!a.ok && a.messageKey).toBe("errors.logistics.roster.unauthenticated");

    vi.mocked(requirePermission).mockRejectedValueOnce(new OrderPermissionError("Organization not found"));
    const b = await clearCover("ayam-norliza-pilot", "t1", "2026-09-03");
    expect(!b.ok && b.messageKey).toBe("errors.logistics.roster.orgNotFound");
  });
});

describe("validation", () => {
  it("rejects a malformed date before touching supabase", async () => {
    vi.mocked(requirePermission).mockResolvedValue(CTX);
    const result = await assignCover("ayam-norliza-pilot", "t1", "3 Sep", "d1");
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.validation");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects a window longer than 42 days", async () => {
    vi.mocked(resolvePermissionsForOrg).mockResolvedValue(resolvedWithViewGrant());
    const result = await getDriverRoster("ayam-norliza-pilot", "2026-08-31", 90);
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.validation");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

describe("trigger errors", () => {
  function supabaseThatFailsUpsert(message: string) {
    const upsert = vi.fn().mockResolvedValue({ error: { message } });
    const from = vi.fn().mockReturnValue({ upsert });
    return { from } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>;
  }

  it("maps driver_on_leave to a curated message, not the raw trigger text", async () => {
    vi.mocked(requirePermission).mockResolvedValue(CTX);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabaseThatFailsUpsert("driver_on_leave"));
    const result = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.driverOnLeave");
    expect(!result.ok && result.message).toBe("That driver is on approved leave that day.");
    expect(!result.ok && result.message).not.toContain("driver_on_leave");
  });

  it("maps driver_double_booked and driver_not_member", async () => {
    vi.mocked(requirePermission).mockResolvedValue(CTX);
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce(supabaseThatFailsUpsert("driver_double_booked"));
    const a = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!a.ok && a.messageKey).toBe("errors.logistics.roster.driverDoubleBooked");

    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce(supabaseThatFailsUpsert("driver_not_member"));
    const b = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!b.ok && b.messageKey).toBe("errors.logistics.roster.driverNotMember");
  });

  it("maps an unrecognized Postgres error to the generic internal message, never the raw text", async () => {
    vi.mocked(requirePermission).mockResolvedValue(CTX);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      supabaseThatFailsUpsert('invalid input syntax for type uuid: "x"'),
    );
    const result = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.internal");
    expect(!result.ok && result.message).toBe("Could not save the roster change.");
  });
});
