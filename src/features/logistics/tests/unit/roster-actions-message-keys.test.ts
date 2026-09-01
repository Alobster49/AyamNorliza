import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/auth/require-permission", () => ({ requirePermission: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { assignCover, clearCover, getDriverRoster, setRegularDriver } from "../../server/roster-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guards", () => {
  it("getDriverRoster maps a permission error to the roster forbidden key", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new OrderPermissionError("Forbidden"));
    const result = await getDriverRoster("ayam-norliza-pilot", "2026-08-31", 14);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.messageKey).toBe("errors.logistics.roster.forbidden");
    }
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
    vi.mocked(requirePermission).mockResolvedValue({ orgId: "org", userId: "u", roleId: "r", roleKey: "seller", timeZone: "Asia/Kuala_Lumpur" });
    const result = await assignCover("ayam-norliza-pilot", "t1", "3 Sep", "d1");
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.validation");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects a window longer than 42 days", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ orgId: "org", userId: "u", roleId: "r", roleKey: "seller", timeZone: "Asia/Kuala_Lumpur" });
    const result = await getDriverRoster("ayam-norliza-pilot", "2026-08-31", 90);
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.validation");
  });
});

describe("trigger errors", () => {
  function supabaseThatFailsUpsert(message: string) {
    const upsert = vi.fn().mockResolvedValue({ error: { message } });
    const from = vi.fn().mockReturnValue({ upsert });
    return { from } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>;
  }

  it("maps driver_on_leave", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ orgId: "org", userId: "u", roleId: "r", roleKey: "seller", timeZone: "Asia/Kuala_Lumpur" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabaseThatFailsUpsert("driver_on_leave"));
    const result = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!result.ok && result.messageKey).toBe("errors.logistics.roster.driverOnLeave");
  });

  it("maps driver_double_booked and driver_not_member", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ orgId: "org", userId: "u", roleId: "r", roleKey: "seller", timeZone: "Asia/Kuala_Lumpur" });
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce(supabaseThatFailsUpsert("driver_double_booked"));
    const a = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!a.ok && a.messageKey).toBe("errors.logistics.roster.driverDoubleBooked");

    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce(supabaseThatFailsUpsert("driver_not_member"));
    const b = await assignCover("ayam-norliza-pilot", "t1", "2026-09-03", "d1");
    expect(!b.ok && b.messageKey).toBe("errors.logistics.roster.driverNotMember");
  });
});
