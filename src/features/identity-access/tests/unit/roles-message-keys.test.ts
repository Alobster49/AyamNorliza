/**
 * Key-assertion tests for `src/features/identity-access/server/roles.ts`.
 * See `actions-message-keys.test.ts` for the shared rationale — this file
 * declares its own local `ActionResult`/`err()`, so it gets its own suite.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/require-user")>("@/lib/auth/require-user");
  return {
    PermissionError: actual.PermissionError,
    requireUser: vi.fn(),
  };
});

vi.mock("@/lib/auth/reauth.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/reauth.server")>("@/lib/auth/reauth.server");
  return {
    ReauthRequiredError: actual.ReauthRequiredError,
    requireReauth: vi.fn(),
  };
});

vi.mock("@/lib/audit/events", () => ({ recordAudit: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, PermissionError } from "@/lib/auth/require-user";
import { requireReauth, ReauthRequiredError } from "@/lib/auth/reauth.server";
import { mockSupabaseWithQueues, type QueryResult } from "./message-key-test-helpers";
import { updateRoleCapabilityAction, resetRoleToDefaultsAction } from "../../server/roles";

function setSupabase(tableQueues: Record<string, QueryResult[]> = {}) {
  const supabase = mockSupabaseWithQueues({ userId: "user-1", tableQueues });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const REASON = "a reason long enough to pass validation";
const ORG_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireReauth).mockResolvedValue({ userId: "user-1", jti: "jti-1" });
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1", email: "a@b.com" } as never);
});

describe("updateRoleCapabilityAction", () => {
  const validInput = { organizationId: ORG_ID, role: "driver", capability: "catalog.manage", granted: true, reason: REASON };

  it("returns common.reauthRequired when step-up is needed", async () => {
    vi.mocked(requireReauth).mockRejectedValue(new ReauthRequiredError());
    const result = await updateRoleCapabilityAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.reauthRequired");
  });

  it("returns common.invalidInput for a bad payload", async () => {
    const result = await updateRoleCapabilityAction({ ...validInput, reason: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.invalidInput");
  });

  it("returns roles.notEditable with the role param for a locked role", async () => {
    const result = await updateRoleCapabilityAction({ ...validInput, role: "owner" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.notEditable");
      expect(result.messageParams).toEqual({ role: "owner" });
    }
  });

  it("returns roles.capabilityLocked with the capability param for a locked capability", async () => {
    const result = await updateRoleCapabilityAction({ ...validInput, capability: "step_up.reauth" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.capabilityLocked");
      expect(result.messageParams).toEqual({ capability: "step_up.reauth" });
    }
  });

  it("returns common.unauthenticated when the caller isn't signed in", async () => {
    vi.mocked(requireUser).mockRejectedValue(new PermissionError("Sign in first"));
    const result = await updateRoleCapabilityAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.unauthenticated");
  });

  it("returns common.notMember when the caller isn't a member", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await updateRoleCapabilityAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.notMember");
  });

  it("returns roles.ownerOnlyEdit for a non-owner caller", async () => {
    setSupabase({ organization_members: [{ data: { role: "org_admin" }, error: null }] });
    const result = await updateRoleCapabilityAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.roles.ownerOnlyEdit");
  });

  it("returns roles.saveOverrideFailed when the upsert returns no row and no Supabase error", async () => {
    setSupabase({
      organization_members: [{ data: { role: "owner" }, error: null }],
      role_capability_overrides: [{ data: null, error: null }],
    });
    const result = await updateRoleCapabilityAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.roles.saveOverrideFailed");
  });

  it("returns common.internal when the upsert reports a Supabase error", async () => {
    setSupabase({
      organization_members: [{ data: { role: "owner" }, error: null }],
      role_capability_overrides: [{ data: null, error: { message: "db down" } }],
    });
    const result = await updateRoleCapabilityAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.internal");
  });
});

describe("resetRoleToDefaultsAction", () => {
  const validInput = { organizationId: ORG_ID, role: "driver", reason: REASON };

  it("returns roles.notEditable with the role param for a locked role", async () => {
    const result = await resetRoleToDefaultsAction({ ...validInput, role: "owner" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.notEditable");
      expect(result.messageParams).toEqual({ role: "owner" });
    }
  });

  it("returns roles.ownerOnlyReset for a non-owner caller", async () => {
    setSupabase({ organization_members: [{ data: { role: "org_admin" }, error: null }] });
    const result = await resetRoleToDefaultsAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.roles.ownerOnlyReset");
  });
});
