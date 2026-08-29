/**
 * Key-assertion tests for `src/features/identity-access/server/actions.ts`.
 *
 * Task 5 converted this file's failure branches to carry an additive
 * `messageKey` (a full path under `errors.identity.*`) alongside the
 * existing prose `message`, following the pattern established in
 * `src/features/buyer/server/actions.ts` / `buyer-auth/server/auth-actions.ts`.
 * These tests lock the exact key returned per branch so a future edit can't
 * silently drop or rename one out from under the (now-converted) UI
 * consumers (`users-page-client.tsx`, `user-detail-client.tsx`,
 * `roles-page-client.tsx`'s siblings, `invite-user-dialog.tsx`,
 * `update-organization-form.tsx`, `support-sessions-client.tsx`,
 * `access-reviews-client.tsx`, `break-glass-dialog.tsx`,
 * `invite/[token]/page.tsx`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/require-user")>("@/lib/auth/require-user");
  return {
    PermissionError: actual.PermissionError,
    requireUser: vi.fn(),
    requireOrgMember: vi.fn(),
  };
});

vi.mock("@/lib/auth/reauth.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/reauth.server")>("@/lib/auth/reauth.server");
  return {
    ReauthRequiredError: actual.ReauthRequiredError,
    requireReauth: vi.fn(),
  };
});

// `actorCan` is a real single-row Supabase lookup (see
// `@/lib/auth/require-permission`); stubbing it out and deferring to the
// legacy, DB-free `can()` matrix keeps these capability-branch assertions
// exactly as they were pre-dynamic-RBAC, without having to queue a
// `role_permissions` row for every one of them. Test fixtures below use the
// role *key* (e.g. "driver", "org_admin") as the `role_id` surrogate so this
// mock can look it up directly -- `role_id` is an opaque foreign key from
// the action's point of view, never validated by Zod.
vi.mock("@/lib/auth/require-permission", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/require-permission")>("@/lib/auth/require-permission");
  return { ...actual, actorCan: vi.fn() };
});

vi.mock("@/lib/audit/events", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  admin: {
    insertAuthSecurityEvent: vi.fn(),
    generateRecoveryLink: vi.fn(async () => ({ hashedToken: "hash-1" })),
  },
}));
vi.mock("@/lib/notifications/dispatch", () => ({ dispatch: vi.fn() }));
vi.mock("../../server/admin-queries", () => ({
  adminCreateInvitation: vi.fn(),
  adminRevokeUserSessions: vi.fn(),
  adminRotateInvitationToken: vi.fn(),
  adminUpdateMemberIdentity: vi.fn(),
  adminDeleteOrgMember: vi.fn(),
  adminCreateOrgUser: vi.fn(),
  adminGetMemberEmails: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/render-invite", () => ({ renderInvite: vi.fn(() => ({ subject: "", html: "" })) }));
vi.mock("@/lib/email/render-password-reset", () => ({ renderPasswordReset: vi.fn(() => ({ subject: "", html: "" })) }));
vi.mock("@/lib/email/render-break-glass", () => ({ renderBreakGlassUsed: vi.fn(() => ({ subject: "", html: "" })) }));
vi.mock("@/lib/env", () => ({
  serverEnv: vi.fn(() => ({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SITE_URL: "https://example.com",
    INVITE_BASE_URL: "https://example.com",
  })),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { requireUser, requireOrgMember, PermissionError } from "@/lib/auth/require-user";
import { requireReauth, ReauthRequiredError } from "@/lib/auth/reauth.server";
import { actorCan } from "@/lib/auth/require-permission";
import { can, type Role, type Capability } from "@/lib/auth/permissions";
import {
  adminCreateInvitation,
  adminUpdateMemberIdentity,
  adminDeleteOrgMember,
  adminGetMemberEmails,
  adminCreateOrgUser,
} from "../../server/admin-queries";
import { mockSupabaseWithQueues, type QueryResult } from "./message-key-test-helpers";
import {
  updateOrganizationSettingsAction,
  inviteUserAction,
  resendInvitationAction,
  revokeInvitationAction,
  acceptInvitationAction,
  changeMemberRoleAction,
  changeMemberScopeAction,
  deactivateUserAction,
  updateMemberProfileAction,
  removeMemberAction,
  sendPasswordResetAction,
  createUserAction,
  startAccessReviewAction,
  decideReviewItemAction,
  openBreakGlassAction,
} from "../../server/actions";

function setSupabase(tableQueues: Record<string, QueryResult[]> = {}, userId: string | null = "user-1") {
  const supabase = mockSupabaseWithQueues({ userId, tableQueues });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

// Mirrors the seeded system-role ranks in
// supabase/migrations/20260901000001_dynamic_rbac_schema.sql's
// `seed_system_roles`. `ROLE_ID` fakes a stable `organization_roles.id`
// per key -- schema validation requires a real UUID shape wherever a role
// is granted (InviteUserInput.roleId etc.), even though these tests never
// touch a real `organization_roles` row.
const RANK_BY_ROLE: Record<string, number> = {
  owner: 100,
  org_admin: 80,
  hr: 75,
  seller: 60,
  supervisor: 60,
  inventory: 40,
  driver: 30,
};
const ROLE_ID: Record<string, string> = {
  owner: "00000000-0000-0000-0000-000000000101",
  org_admin: "00000000-0000-0000-0000-000000000102",
  hr: "00000000-0000-0000-0000-000000000103",
  seller: "00000000-0000-0000-0000-000000000104",
  supervisor: "00000000-0000-0000-0000-000000000105",
  inventory: "00000000-0000-0000-0000-000000000106",
  driver: "00000000-0000-0000-0000-000000000107",
};
/** A queued `organization_roles` row for `resolveOrgRole()`'s lookup. */
const ORG_ROLE = (roleKey: string) => ({
  data: { id: ROLE_ID[roleKey], key: roleKey, name: roleKey, rank: RANK_BY_ROLE[roleKey] },
  error: null,
});

const ACTIVE_MEMBER = (role: string) => ({
  data: { role, role_id: role, organization_roles: { rank: RANK_BY_ROLE[role] ?? 0 } },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireReauth).mockResolvedValue({ userId: "user-1", jti: "jti-1" });
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1", email: "a@b.com" } as never);
  vi.mocked(actorCan).mockImplementation(async (roleId, capability) =>
    can(roleId as Role, capability as Capability),
  );
});

describe("updateOrganizationSettingsAction", () => {
  it("returns organization.invalidUpdate for a bad payload", async () => {
    const result = await updateOrganizationSettingsAction({ organizationId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.organization.invalidUpdate");
  });

  it("returns common.notMember when the caller isn't a member", async () => {
    vi.mocked(requireOrgMember).mockRejectedValue(new PermissionError("Not a member of this organization"));
    const result = await updateOrganizationSettingsAction({ organizationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.notMember");
  });

  it("returns organization.updateForbidden when the role lacks the capability", async () => {
    vi.mocked(requireOrgMember).mockResolvedValue({ role: "driver", role_id: "driver", user_id: "user-1" } as never);
    const result = await updateOrganizationSettingsAction({ organizationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.organization.updateForbidden");
  });
});

describe("inviteUserAction", () => {
  const validInput = {
    organizationId: "11111111-1111-1111-1111-111111111111",
    email: "x@y.com",
    roleId: ROLE_ID.driver,
    scopes: [],
  };

  it("returns invite.invalidInput for a bad payload", async () => {
    const result = await inviteUserAction({ organizationId: "bad", email: "x", roleId: "driver", scopes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.invalidInput");
  });

  it("returns common.unauthenticated when signed out", async () => {
    setSupabase({}, null);
    const result = await inviteUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.unauthenticated");
  });

  it("returns common.notMember when the caller has no active membership", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await inviteUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.notMember");
  });

  it("returns invite.roleCannotInvite when the caller's role can't invite", async () => {
    setSupabase({ organization_members: [ACTIVE_MEMBER("driver")] });
    const result = await inviteUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.roleCannotInvite");
  });

  it("returns roles.cannotGrantRole with the role param when the target role outranks the caller", async () => {
    setSupabase({
      organization_members: [ACTIVE_MEMBER("org_admin")],
      organization_roles: [ORG_ROLE("owner")],
    });
    const result = await inviteUserAction({ ...validInput, roleId: ROLE_ID.owner });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
      expect(result.messageParams).toEqual({ role: "owner" });
    }
  });

  it("returns roles.cannotGrantRole when the roleId doesn't belong to this org", async () => {
    // resolveOrgRole's `.eq("organization_id", ...)` filter means a roleId
    // from a different org (or a nonexistent one) comes back null, not a
    // row with the wrong org_id -- the mock simulates that directly.
    setSupabase({
      organization_members: [ACTIVE_MEMBER("owner")],
      organization_roles: [{ data: null, error: null }],
    });
    const result = await inviteUserAction({ ...validInput, roleId: "99999999-9999-9999-9999-999999999999" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
  });

  it("denies granting the owner key even when the actor's rank is inflated", async () => {
    // Defense-in-depth for the DB-side rank cap (20260901000003): even if
    // an actor's own rank were somehow inflated past 100 (a corrupted row,
    // a bug, a future write path this app doesn't control), the key check
    // is independent of rank and still blocks minting a second owner.
    setSupabase({
      organization_members: [
        {
          data: {
            id: "actor-1",
            role: "org_admin",
            role_id: "org_admin",
            organization_id: "org-1",
            organization_roles: { rank: 999 },
          },
          error: null,
        },
      ],
      organization_roles: [ORG_ROLE("owner")],
    });
    const result = await inviteUserAction({ ...validInput, roleId: ROLE_ID.owner });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
      expect(result.messageParams).toEqual({ role: "owner" });
    }
  });

  it("returns invite.createFailed when adminCreateInvitation throws an Error", async () => {
    setSupabase({
      organization_members: [ACTIVE_MEMBER("org_admin")],
      organization_roles: [ORG_ROLE("driver")],
    });
    vi.mocked(adminCreateInvitation).mockRejectedValue(new Error("duplicate invitation"));
    const result = await inviteUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.createFailed");
  });

  it("returns invite.createFailedUnknown when adminCreateInvitation throws a non-Error", async () => {
    setSupabase({
      organization_members: [ACTIVE_MEMBER("org_admin")],
      organization_roles: [ORG_ROLE("driver")],
    });
    vi.mocked(adminCreateInvitation).mockRejectedValue("some non-Error throw");
    const result = await inviteUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.createFailedUnknown");
  });
});

describe("resendInvitationAction", () => {
  it("returns invite.notFound when the invitation doesn't exist", async () => {
    setSupabase({ invitations: [{ data: null, error: null }] });
    const result = await resendInvitationAction({ invitationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.notFound");
  });

  it("returns invite.alreadyAccepted when the invitation was already accepted", async () => {
    setSupabase({
      invitations: [{ data: { id: "inv-1", organization_id: "org-1", accepted_at: "2024-01-01", revoked_at: null }, error: null }],
    });
    const result = await resendInvitationAction({ invitationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.alreadyAccepted");
  });

  it("returns invite.revoked when the invitation was revoked", async () => {
    setSupabase({
      invitations: [{ data: { id: "inv-1", organization_id: "org-1", accepted_at: null, revoked_at: "2024-01-01" }, error: null }],
    });
    const result = await resendInvitationAction({ invitationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.revoked");
  });

  it("returns common.forbidden when the caller can't invite", async () => {
    setSupabase({
      invitations: [{ data: { id: "inv-1", organization_id: "org-1", accepted_at: null, revoked_at: null }, error: null }],
      organization_members: [{ data: { role: "driver", role_id: "driver" }, error: null }],
    });
    const result = await resendInvitationAction({ invitationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.forbidden");
  });
});

describe("revokeInvitationAction", () => {
  it("returns invite.notFound when the invitation doesn't exist", async () => {
    setSupabase({ invitations: [{ data: null, error: null }] });
    const result = await revokeInvitationAction({ invitationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.notFound");
  });
});

describe("acceptInvitationAction", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns common.invalidInput for a bad payload", async () => {
    const result = await acceptInvitationAction({ token: "", displayName: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.invalidInput");
  });

  it("returns invite.expired when the Edge Function reports an expired token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "expired" }),
    }) as unknown as typeof fetch;
    const result = await acceptInvitationAction({ token: "raw-token-that-is-long-enough", displayName: "Someone" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.expired");
    global.fetch = originalFetch;
  });

  it("returns invite.acceptFailed for an unrecognized Edge Function error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "some_other_thing" }),
    }) as unknown as typeof fetch;
    const result = await acceptInvitationAction({ token: "raw-token-that-is-long-enough", displayName: "Someone" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.acceptFailed");
    global.fetch = originalFetch;
  });
});

describe("changeMemberRoleAction", () => {
  const validInput = {
    memberId: "11111111-1111-1111-1111-111111111111",
    newRoleId: ROLE_ID.driver,
    reason: "reason text long enough",
  };

  it("returns common.reauthRequired when step-up is needed", async () => {
    vi.mocked(requireReauth).mockRejectedValue(new ReauthRequiredError());
    const result = await changeMemberRoleAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.reauthRequired");
  });

  it("returns member.notFound when the target member doesn't exist", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await changeMemberRoleAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.notFound");
  });

  it("returns member.alreadyHasRole when the role is unchanged", async () => {
    setSupabase({
      organization_members: [
        {
          data: { id: "m-1", organization_id: "org-1", role: "driver", user_id: "target-1", organization_roles: { rank: RANK_BY_ROLE.driver } },
          error: null,
        },
        ACTIVE_MEMBER("org_admin"),
      ],
      organization_roles: [ORG_ROLE("driver")],
    });
    const result = await changeMemberRoleAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.alreadyHasRole");
  });

  it("returns member.ownerNeedsApprover for an owner transfer with no approver", async () => {
    setSupabase({
      organization_members: [
        {
          data: { id: "m-1", organization_id: "org-1", role: "org_admin", user_id: "target-1", organization_roles: { rank: RANK_BY_ROLE.org_admin } },
          error: null,
        },
        ACTIVE_MEMBER("owner"),
      ],
      organization_roles: [ORG_ROLE("owner")],
    });
    const result = await changeMemberRoleAction({ ...validInput, newRoleId: ROLE_ID.owner });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.ownerNeedsApprover");
  });

  // The following demote-an-owner scenarios (target role "owner", newRoleId
  // "driver" from validInput) are the confirmed exploit path: an
  // org_admin's canGrantRole check passes for "driver" (rank <= org_admin),
  // so these reach the approver gate the same way the reported bug did.

  it("returns member.ownerNeedsApprover when demoting an owner without an approver", async () => {
    setSupabase({
      organization_members: [
        { data: { id: "m-1", organization_id: "org-1", role: "owner", user_id: "target-1" }, error: null },
        ACTIVE_MEMBER("org_admin"),
      ],
      organization_roles: [ORG_ROLE("driver")],
    });
    const result = await changeMemberRoleAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.ownerNeedsApprover");
  });

  it("returns member.ownerNeedsApprover when approverUserId is not a real, active member of the org", async () => {
    setSupabase({
      organization_members: [
        { data: { id: "m-1", organization_id: "org-1", role: "owner", user_id: "target-1" }, error: null },
        ACTIVE_MEMBER("org_admin"),
        { data: null, error: null }, // approver lookup: no matching active member
      ],
      organization_roles: [ORG_ROLE("driver")],
    });
    const result = await changeMemberRoleAction({
      ...validInput,
      approverUserId: "22222222-2222-2222-2222-222222222222",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.ownerNeedsApprover");
  });

  it("returns member.ownerNeedsApprover when approverUserId is the acting user themselves", async () => {
    const callerId = "22222222-2222-2222-2222-222222222222";
    vi.mocked(requireUser).mockResolvedValue({ id: callerId, email: "a@b.com" } as never);
    setSupabase(
      {
        organization_members: [
          { data: { id: "m-1", organization_id: "org-1", role: "owner", user_id: "target-1" }, error: null },
          ACTIVE_MEMBER("org_admin"),
        ],
        organization_roles: [ORG_ROLE("driver")],
      },
      callerId,
    );
    const result = await changeMemberRoleAction({
      ...validInput,
      approverUserId: callerId, // same as the acting user
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.ownerNeedsApprover");
  });

  it("returns member.ownerNeedsApprover when approverUserId is a real member who is not an owner", async () => {
    setSupabase({
      organization_members: [
        { data: { id: "m-1", organization_id: "org-1", role: "owner", user_id: "target-1" }, error: null },
        ACTIVE_MEMBER("org_admin"),
        { data: { role: "org_admin" }, error: null }, // approver lookup: active but not an owner
      ],
      organization_roles: [ORG_ROLE("driver")],
    });
    const result = await changeMemberRoleAction({
      ...validInput,
      approverUserId: "22222222-2222-2222-2222-222222222222",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.ownerNeedsApprover");
  });

  it("denies managing a member holding a higher-ranked (non-owner) custom role", async () => {
    // Target-rank comparison (Important #2): an org_admin (rank 80) must
    // not be able to act on a member currently holding some other role
    // ranked above them, even when that role isn't "owner" -- e.g. a
    // custom role a real owner ranked at 90. The DB-side rank cap
    // (20260901000003) prevents a *custom* role from ever reaching 90, but
    // this app-side check is the fail-safe for any row that predates it or
    // reaches this table another way.
    setSupabase({
      organization_members: [
        {
          data: {
            id: "m-1",
            organization_id: "org-1",
            role: "regional_lead",
            user_id: "target-1",
            organization_roles: { rank: 90 },
          },
          error: null,
        },
        ACTIVE_MEMBER("org_admin"),
      ],
    });
    const result = await changeMemberRoleAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
      expect(result.messageParams).toEqual({ role: "regional_lead" });
    }
  });

  it("succeeds when approverUserId is a real, active, distinct owner", async () => {
    setSupabase({
      organization_members: [
        { data: { id: "m-1", organization_id: "org-1", role: "owner", user_id: "target-1" }, error: null },
        ACTIVE_MEMBER("org_admin"),
        { data: { role: "owner" }, error: null }, // approver lookup: active owner
        { data: { id: "m-1", role: "driver" }, error: null }, // the update itself
      ],
      organization_roles: [ORG_ROLE("driver")],
    });
    const result = await changeMemberRoleAction({
      ...validInput,
      approverUserId: "22222222-2222-2222-2222-222222222222",
    });
    expect(result.ok).toBe(true);
  });
});

describe("changeMemberScopeAction", () => {
  it("returns member.notFound when the target member doesn't exist", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await changeMemberScopeAction({ memberId: "11111111-1111-1111-1111-111111111111", scopes: [], reason: "reason text long enough" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.notFound");
  });
});

describe("deactivateUserAction", () => {
  const validInput = { memberId: "11111111-1111-1111-1111-111111111111", reason: "reason text long enough" };

  it("returns member.transferOwnershipFirst for an active owner", async () => {
    setSupabase({
      organization_members: [{ data: { id: "m-1", organization_id: "org-1", user_id: "target-1", role: "owner", status: "active" }, error: null }],
    });
    const result = await deactivateUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.transferOwnershipFirst");
  });
});

describe("updateMemberProfileAction", () => {
  const UUID = "11111111-1111-1111-1111-111111111111";
  const validInput = { memberId: UUID, displayName: "New Name", reason: "correcting name" };
  const TARGET = {
    data: { id: UUID, organization_id: "org-1", user_id: "u-target", role: "driver", organization_roles: { rank: RANK_BY_ROLE.driver } },
    error: null,
  };

  it("returns common.invalidInput when nothing to update", async () => {
    const result = await updateMemberProfileAction({ memberId: UUID, reason: "no fields to change" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.invalidInput");
  });

  it("returns member.notFound for an unknown member", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await updateMemberProfileAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.notFound");
  });

  it("returns common.forbidden when the actor's role can't manage members", async () => {
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("driver")] });
    const result = await updateMemberProfileAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.forbidden");
  });

  it("returns roles.cannotGrantRole when an org_admin edits an owner", async () => {
    setSupabase({
      organization_members: [
        {
          data: { id: UUID, organization_id: "org-1", user_id: "u-owner", role: "owner", organization_roles: { rank: RANK_BY_ROLE.owner } },
          error: null,
        },
        ACTIVE_MEMBER("org_admin"),
      ],
    });
    const result = await updateMemberProfileAction({ memberId: UUID, email: "takeover@x.my", reason: "escalation attempt" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
      expect(result.messageParams).toEqual({ role: "owner" });
    }
    expect(adminUpdateMemberIdentity).not.toHaveBeenCalled();
  });

  it("returns member.emailInUse when the email is already registered", async () => {
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminUpdateMemberIdentity).mockRejectedValue(
      Object.assign(new Error("email exists"), { code: "email_exists", status: 422 }),
    );
    const result = await updateMemberProfileAction({ memberId: UUID, email: "dup@x.my", reason: "duplicate email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.emailInUse");
  });

  it("succeeds for an org_admin name update", async () => {
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminUpdateMemberIdentity).mockResolvedValue();
    const result = await updateMemberProfileAction(validInput);
    expect(result.ok).toBe(true);
  });
});

describe("removeMemberAction", () => {
  const UUID = "11111111-1111-1111-1111-111111111111";
  const validInput = { memberId: UUID, reason: "left the farm" };
  const TARGET = (over: Partial<{ user_id: string; role: string; status: string }> = {}) => {
    const role = over.role ?? "driver";
    return {
      data: {
        id: UUID,
        organization_id: "org-1",
        user_id: "u-target",
        role,
        status: "active",
        organization_roles: { rank: RANK_BY_ROLE[role] ?? 0 },
        ...over,
      },
      error: null,
    };
  };

  it("returns member.notFound for an unknown member", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await removeMemberAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.notFound");
  });

  it("returns member.cannotRemoveSelf when removing yourself", async () => {
    setSupabase({ organization_members: [TARGET({ user_id: "user-1" })] });
    const result = await removeMemberAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.cannotRemoveSelf");
  });

  it("returns member.transferOwnershipFirst for an active owner", async () => {
    setSupabase({ organization_members: [TARGET({ role: "owner" })] });
    const result = await removeMemberAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.transferOwnershipFirst");
  });

  it("returns common.forbidden when the actor lacks membership.deactivate", async () => {
    setSupabase({ organization_members: [TARGET(), ACTIVE_MEMBER("driver")] });
    const result = await removeMemberAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.forbidden");
  });

  it("removes and revokes sessions for an org_admin", async () => {
    setSupabase({ organization_members: [TARGET(), ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminDeleteOrgMember).mockResolvedValue();
    const result = await removeMemberAction(validInput);
    expect(result.ok).toBe(true);
    expect(adminDeleteOrgMember).toHaveBeenCalledWith(UUID, expect.anything());
  });
});

describe("sendPasswordResetAction", () => {
  const UUID = "11111111-1111-1111-1111-111111111111";
  const TARGET = { data: { id: UUID, organization_id: "org-1", user_id: "u-target" }, error: null };

  it("returns member.notFound for an unknown member", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await sendPasswordResetAction({ memberId: UUID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.notFound");
  });

  it("returns common.forbidden when the actor cannot invite", async () => {
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("driver")] });
    const result = await sendPasswordResetAction({ memberId: UUID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.forbidden");
  });

  it("returns member.noEmail when the target has no auth email", async () => {
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminGetMemberEmails).mockResolvedValue(new Map([["u-target", null]]));
    const result = await sendPasswordResetAction({ memberId: UUID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.noEmail");
  });

  it("sends the reset email for an org_admin via an admin recovery link", async () => {
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminGetMemberEmails).mockResolvedValue(new Map([["u-target", "t@x.my"]]));
    const result = await sendPasswordResetAction({ memberId: UUID });
    expect(result.ok).toBe(true);
    expect(admin.generateRecoveryLink).toHaveBeenCalledWith("t@x.my");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["t@x.my"] }));
  });

  it("returns member.resetFailed when the recovery link cannot be generated", async () => {
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminGetMemberEmails).mockResolvedValue(new Map([["u-target", "t@x.my"]]));
    vi.mocked(admin.generateRecoveryLink).mockRejectedValueOnce(new Error("gotrue down"));
    const result = await sendPasswordResetAction({ memberId: UUID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.resetFailed");
  });
});

describe("createUserAction", () => {
  const validInput = {
    organizationId: "11111111-1111-1111-1111-111111111111",
    email: "staff@ayam.my",
    displayName: "New Staff",
    roleId: ROLE_ID.driver,
  };

  it("returns common.invalidInput for a bad payload", async () => {
    const result = await createUserAction({ ...validInput, email: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.invalidInput");
  });

  it("returns common.notMember when the caller has no active membership", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.notMember");
  });

  it("returns invite.roleCannotInvite when the caller's role can't invite", async () => {
    setSupabase({ organization_members: [ACTIVE_MEMBER("driver")] });
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.roleCannotInvite");
  });

  it("returns roles.cannotGrantRole when the target role outranks the caller", async () => {
    setSupabase({
      organization_members: [ACTIVE_MEMBER("org_admin")],
      organization_roles: [ORG_ROLE("owner")],
    });
    const result = await createUserAction({ ...validInput, roleId: ROLE_ID.owner });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
  });

  it("returns user.emailInUse on a duplicate email", async () => {
    setSupabase({
      organization_members: [ACTIVE_MEMBER("org_admin")],
      organization_roles: [ORG_ROLE("driver")],
    });
    vi.mocked(adminCreateOrgUser).mockRejectedValue(
      Object.assign(new Error("email exists"), { code: "email_exists", status: 422 }),
    );
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.user.emailInUse");
  });

  it("creates the user and sends a set-password email for an org_admin", async () => {
    setSupabase({
      organization_members: [ACTIVE_MEMBER("org_admin")],
      organization_roles: [ORG_ROLE("driver")],
    });
    vi.mocked(adminCreateOrgUser).mockResolvedValue({ userId: "new-user" });
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(true);
    expect(admin.generateRecoveryLink).toHaveBeenCalledWith("staff@ayam.my");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["staff@ayam.my"] }));
  });

  it("still succeeds when the set-password email fails (best-effort)", async () => {
    setSupabase({
      organization_members: [ACTIVE_MEMBER("org_admin")],
      organization_roles: [ORG_ROLE("driver")],
    });
    vi.mocked(adminCreateOrgUser).mockResolvedValue({ userId: "new-user" });
    vi.mocked(admin.generateRecoveryLink).mockRejectedValueOnce(new Error("gotrue down"));
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(true);
  });
});

describe("startAccessReviewAction", () => {
  it("returns common.forbidden when the caller lacks access_review.run", async () => {
    setSupabase({ organization_members: [{ data: { role: "driver", role_id: "driver" }, error: null }] });
    const result = await startAccessReviewAction({
      organizationId: "11111111-1111-1111-1111-111111111111",
      periodStart: new Date().toISOString(),
      periodEnd: new Date().toISOString(),
      dueAt: new Date().toISOString(),
      reviewerId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.forbidden");
  });
});

describe("decideReviewItemAction", () => {
  it("returns accessReview.itemNotFound when the item doesn't exist", async () => {
    setSupabase({ access_review_items: [{ data: null, error: null }] });
    const result = await decideReviewItemAction({ itemId: "11111111-1111-1111-1111-111111111111", decision: "keep" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.accessReview.itemNotFound");
  });

  it("returns accessReview.reviewNotFound when the parent review is missing", async () => {
    setSupabase({
      access_review_items: [{ data: { id: "item-1", access_review_id: "rev-1", organization_member_id: "m-1", decision: "pending" }, error: null }],
      access_reviews: [{ data: null, error: null }],
    });
    const result = await decideReviewItemAction({ itemId: "11111111-1111-1111-1111-111111111111", decision: "keep" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.accessReview.reviewNotFound");
  });
});

describe("openBreakGlassAction", () => {
  it("returns common.notMember when the caller has no active membership", async () => {
    setSupabase({ organization_members: [{ data: null, error: null }] });
    const result = await openBreakGlassAction({
      organizationId: "11111111-1111-1111-1111-111111111111",
      reason: "0123456789",
      ticketReference: null,
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.notMember");
  });

  it("returns breakGlass.cannotOpen when the role lacks break_glass.open", async () => {
    setSupabase({ organization_members: [{ data: { role: "driver", role_id: "driver" }, error: null }] });
    const result = await openBreakGlassAction({
      organizationId: "11111111-1111-1111-1111-111111111111",
      reason: "0123456789",
      ticketReference: null,
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.breakGlass.cannotOpen");
  });
});
