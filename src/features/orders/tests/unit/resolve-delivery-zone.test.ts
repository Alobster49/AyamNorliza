/**
 * Unit tests for `resolveDeliveryZone` (order-actions). The Supabase server
 * client is mocked; the dynamic-RBAC `requirePermission` guard (in
 * @/lib/auth/require-permission) is mocked directly rather than exercised
 * through a simulated `organization_members` row — `resolveDeliveryZone`
 * now gates on the `('orders','view')` permission grant, not a role array.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-permission", () => ({
  requirePermission: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OrderPermissionError } from "../../server/guards";
import { resolveDeliveryZone } from "../../server/order-actions";

/**
 * Configures the mocked `requirePermission` guard. `granted: true` resolves
 * with a permission context (mirrors an "orders view" grant); `granted:
 * false` rejects with `OrderPermissionError`, mirroring a caller whose role
 * holds no such grant (e.g. the retired "support" role).
 */
function mockGuard({
  orgId = "org-1",
  granted = true,
}: { orgId?: string; granted?: boolean } = {}) {
  if (granted) {
    vi.mocked(requirePermission).mockResolvedValue({
      orgId,
      userId: "user-1",
      roleId: "role-1",
      roleKey: "owner",
      timeZone: "Asia/Kuala_Lumpur",
    });
  } else {
    vi.mocked(requirePermission).mockRejectedValue(new OrderPermissionError());
  }
}

function mockSupabaseRpc(rpcResult: { data: unknown; error: { message: string } | null }) {
  const supabase = { rpc: vi.fn().mockResolvedValue(rpcResult) };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(requirePermission).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveDeliveryZone", () => {
  it("returns the resolved zone id for a covered postcode", async () => {
    mockGuard();
    mockSupabaseRpc({ data: "44444444-4444-4444-4444-444444444444", error: null });

    const result = await resolveDeliveryZone("acme", "80000");

    expect(result).toEqual({
      ok: true,
      data: { zoneId: "44444444-4444-4444-4444-444444444444" },
    });
  });

  it("returns a null zone id when no zone covers the postcode", async () => {
    mockGuard();
    mockSupabaseRpc({ data: null, error: null });

    const result = await resolveDeliveryZone("acme", "50000");

    expect(result).toEqual({ ok: true, data: { zoneId: null } });
  });

  it("rejects a malformed postcode without calling the rpc", async () => {
    mockGuard();
    const supabase = mockSupabaseRpc({ data: null, error: null });

    const result = await resolveDeliveryZone("acme", "800");

    expect(result.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("passes the guarded org id to the rpc", async () => {
    mockGuard({ orgId: "org-42" });
    const supabase = mockSupabaseRpc({ data: null, error: null });

    await resolveDeliveryZone("acme", "80000");

    expect(supabase.rpc).toHaveBeenCalledWith("resolve_zone_for_postcode", {
      p_org: "org-42",
      p_postcode: "80000",
    });
  });

  it("refuses a caller without the orders permission grant", async () => {
    mockGuard({ granted: false });
    const supabase = mockSupabaseRpc({ data: null, error: null });

    const result = await resolveDeliveryZone("acme", "80000");

    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns an internal error when the rpc fails", async () => {
    mockGuard();
    mockSupabaseRpc({ data: null, error: { message: "boom" } });

    const result = await resolveDeliveryZone("acme", "80000");

    expect(result).toMatchObject({ ok: false, code: "internal" });
  });
});
