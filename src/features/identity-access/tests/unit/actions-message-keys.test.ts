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

vi.mock("@/lib/audit/events", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ admin: { insertAuthSecurityEvent: vi.fn() } }));
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
import { requireUser, requireOrgMember, PermissionError } from "@/lib/auth/require-user";
import { requireReauth, ReauthRequiredError } from "@/lib/auth/reauth.server";
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
  openSupportSessionAction,
  endSupportSessionAction,
  openBreakGlassAction,
} from "../../server/actions";

function setSupabase(tableQueues: Record<string, QueryResult[]> = {}, userId: string | null = "user-1") {
  const supabase = mockSupabaseWithQueues({ userId, tableQueues });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const ACTIVE_MEMBER = (role: string) => ({ data: { role }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireReauth).mockResolvedValue({ userId: "user-1", jti: "jti-1" });
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1", email: "a@b.com" } as never);
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
    vi.mocked(requireOrgMember).mockResolvedValue({ role: "caretaker", user_id: "user-1" } as never);
    const result = await updateOrganizationSettingsAction({ organizationId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.organization.updateForbidden");
  });
});

describe("inviteUserAction", () => {
  const validInput = { organizationId: "11111111-1111-1111-1111-111111111111", email: "x@y.com", role: "caretaker", scopes: [] };

  it("returns invite.invalidInput for a bad payload", async () => {
    const result = await inviteUserAction({ organizationId: "bad", email: "x", role: "caretaker", scopes: [] });
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
    setSupabase({ organization_members: [ACTIVE_MEMBER("caretaker")] });
    const result = await inviteUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.roleCannotInvite");
  });

  it("returns roles.cannotGrantRole with the role param when the target role outranks the caller", async () => {
    setSupabase({ organization_members: [ACTIVE_MEMBER("org_admin")] });
    const result = await inviteUserAction({ ...validInput, role: "owner" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
      expect(result.messageParams).toEqual({ role: "owner" });
    }
  });

  it("returns invite.createFailed when adminCreateInvitation throws an Error", async () => {
    setSupabase({ organization_members: [ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminCreateInvitation).mockRejectedValue(new Error("duplicate invitation"));
    const result = await inviteUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.createFailed");
  });

  it("returns invite.createFailedUnknown when adminCreateInvitation throws a non-Error", async () => {
    setSupabase({ organization_members: [ACTIVE_MEMBER("org_admin")] });
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
      organization_members: [{ data: { role: "caretaker" }, error: null }],
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
  const validInput = { memberId: "11111111-1111-1111-1111-111111111111", newRole: "caretaker", reason: "reason text long enough" };

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
        { data: { id: "m-1", organization_id: "org-1", role: "caretaker", user_id: "target-1" }, error: null },
        ACTIVE_MEMBER("org_admin"),
      ],
    });
    const result = await changeMemberRoleAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.alreadyHasRole");
  });

  it("returns member.ownerNeedsApprover for an owner transfer with no approver", async () => {
    setSupabase({
      organization_members: [
        { data: { id: "m-1", organization_id: "org-1", role: "org_admin", user_id: "target-1" }, error: null },
        ACTIVE_MEMBER("owner"),
      ],
    });
    const result = await changeMemberRoleAction({ ...validInput, newRole: "owner" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.member.ownerNeedsApprover");
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
  const TARGET = { data: { id: UUID, organization_id: "org-1", user_id: "u-target", role: "caretaker" }, error: null };

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
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("caretaker")] });
    const result = await updateMemberProfileAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.forbidden");
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
  const TARGET = (over: Partial<{ user_id: string; role: string; status: string }> = {}) => ({
    data: { id: UUID, organization_id: "org-1", user_id: "u-target", role: "caretaker", status: "active", ...over },
    error: null,
  });

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
    setSupabase({ organization_members: [TARGET(), ACTIVE_MEMBER("caretaker")] });
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
    setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("caretaker")] });
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

  it("sends the reset email for an org_admin", async () => {
    const supabase = setSupabase({ organization_members: [TARGET, ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminGetMemberEmails).mockResolvedValue(new Map([["u-target", "t@x.my"]]));
    const result = await sendPasswordResetAction({ memberId: UUID });
    expect(result.ok).toBe(true);
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "t@x.my",
      expect.objectContaining({ redirectTo: expect.stringContaining("/auth/callback?next=/set-password") }),
    );
  });
});

describe("createUserAction", () => {
  const validInput = {
    organizationId: "11111111-1111-1111-1111-111111111111",
    email: "staff@ayam.my",
    displayName: "New Staff",
    role: "caretaker",
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
    setSupabase({ organization_members: [ACTIVE_MEMBER("caretaker")] });
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.invite.roleCannotInvite");
  });

  it("returns roles.cannotGrantRole when the target role outranks the caller", async () => {
    setSupabase({ organization_members: [ACTIVE_MEMBER("org_admin")] });
    const result = await createUserAction({ ...validInput, role: "owner" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.roles.cannotGrantRole");
  });

  it("returns user.emailInUse on a duplicate email", async () => {
    setSupabase({ organization_members: [ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminCreateOrgUser).mockRejectedValue(
      Object.assign(new Error("email exists"), { code: "email_exists", status: 422 }),
    );
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.user.emailInUse");
  });

  it("creates the user and sends a set-password email for an org_admin", async () => {
    const supabase = setSupabase({ organization_members: [ACTIVE_MEMBER("org_admin")] });
    vi.mocked(adminCreateOrgUser).mockResolvedValue({ userId: "new-user" });
    const result = await createUserAction(validInput);
    expect(result.ok).toBe(true);
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalled();
  });
});

describe("startAccessReviewAction", () => {
  it("returns common.forbidden when the caller lacks access_review.run", async () => {
    setSupabase({ organization_members: [{ data: { role: "caretaker" }, error: null }] });
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

describe("openSupportSessionAction", () => {
  it("returns common.reauthRequired when step-up is needed", async () => {
    vi.mocked(requireReauth).mockRejectedValue(new ReauthRequiredError());
    const result = await openSupportSessionAction({
      organizationId: "11111111-1111-1111-1111-111111111111",
      sponsorId: "11111111-1111-1111-1111-111111111111",
      technicianId: "11111111-1111-1111-1111-111111111111",
      purpose: "purpose text",
      permittedScopes: [],
      startsAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.reauthRequired");
  });
});

describe("endSupportSessionAction", () => {
  it("returns supportSession.notFound when the session doesn't exist", async () => {
    setSupabase({ support_sessions: [{ data: null, error: null }] });
    const result = await endSupportSessionAction({ sessionId: "11111111-1111-1111-1111-111111111111", revokeMembership: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.supportSession.notFound");
  });

  it("returns supportSession.alreadyEnded when the session already ended", async () => {
    setSupabase({
      support_sessions: [{ data: { id: "s-1", organization_id: "org-1", technician_id: "tech-1", status: "ended" }, error: null }],
    });
    const result = await endSupportSessionAction({ sessionId: "11111111-1111-1111-1111-111111111111", revokeMembership: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.supportSession.alreadyEnded");
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
    setSupabase({ organization_members: [{ data: { role: "caretaker" }, error: null }] });
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
