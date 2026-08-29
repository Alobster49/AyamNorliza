/**
 * Server Actions for MOD-01.
 *
 * Each action follows the 8-step contract from the shared security doc
 * (Zod parse -> identity check -> permission/scope check -> RLS
 * mutation -> atomic multi-table op if needed -> audit row in the same
 * transaction -> safe field errors -> revalidatePath/Tag).
 *
 * Step-up: sensitive actions (`changeMemberRole`, `changeMemberScope`,
 * `deactivateUser`,
 * `openBreakGlass`) call `requireReauth()` first. The reauth cookie is
 * issued by `POST /api/auth/reauth`.
 *
 * Error contract: every action returns a discriminated union so the
 * client can render either a toast or open the reauth dialog without
 * having to `try/catch` per action.
 */

"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { randomUUID } from "node:crypto";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin, type AdminContext } from "@/lib/supabase/admin";
import { requireUser, requireOrgMember, PermissionError } from "@/lib/auth/require-user";
import { requireReauth, ReauthRequiredError } from "@/lib/auth/reauth.server";
import { actorCan } from "@/lib/auth/require-permission";
import { canGrantRole } from "@/lib/auth/permissions";
import { recordAudit } from "@/lib/audit/events";
import { dispatch } from "@/lib/notifications/dispatch";
import {
  AcceptInvitationInput,
  ChangeRoleInput,
  ChangeScopeInput,
  CreateOrganizationInput,
  DeactivateUserInput,
  DecideReviewItemInput,
  EndBreakGlassInput,
  FinalizeBreakGlassReviewInput,
  InviteUserInput,
  OpenBreakGlassInput,
  ResendInvitationInput,
  RevokeInvitationInput,
  StartAccessReviewInput,
  UpdateMemberProfileInput,
  SendPasswordResetInput,
  RemoveMemberInput,
  CreateUserInput,
  UpdateOrganizationInput,
} from "../schema";
import {
  adminCreateInvitation,
  adminRevokeUserSessions,
  adminRotateInvitationToken,
  adminUpdateMemberIdentity,
  adminDeleteOrgMember,
  adminCreateOrgUser,
  adminGetMemberEmails,
} from "./admin-queries";
import { groupOwnerEmailsByLocale } from "./break-glass-recipients";
import { sendEmail } from "@/lib/email/resend";
import { renderInvite } from "@/lib/email/render-invite";
import { renderPasswordReset } from "@/lib/email/render-password-reset";
import { renderBreakGlassUsed } from "@/lib/email/render-break-glass";
import { serverEnv } from "@/lib/env";
import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "@/lib/i18n/locales";

/** The invitee has no `profiles`/`buyers` row yet — the organization's
 * default locale is the best available signal for which language to send
 * the invitation in. Falls back to `DEFAULT_LOCALE` for an unrecognized
 * value (the column predates the `en`/`ms` check constraint). */
function resolveLocale(value: unknown): AppLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      /**
       * Full path under `errors.identity.*` for a client to resolve with a
       * root-namespace `useTranslations()` + `t(messageKey as never)`.
       * Additive: only the branches consumed by converted i18n surfaces set
       * it — `message` stays the source of truth for non-UI callers (the
       * `/api/auth/*` routes, which return it verbatim as JSON).
       */
      messageKey?: string;
      /** ICU params for `messageKey` (e.g. `{ role: input.newRole }`). */
      messageParams?: Record<string, string | number>;
      fieldErrors?: Record<string, string[]>;
    };

export type ActionErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "reauth_required"
  | "not_found"
  | "conflict"
  | "internal";

function err<T = never>(
  code: ActionErrorCode,
  message: string,
  messageKey?: string,
  fieldErrors?: Record<string, string[]>,
  messageParams?: Record<string, string | number>,
): ActionResult<T> {
  return {
    ok: false,
    code,
    message,
    ...(messageKey ? { messageKey } : {}),
    ...(messageParams ? { messageParams } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function ctxFor(userId: string): Promise<AdminContext> {
  return { actorUserId: userId, correlationId: randomUUID() };
}

type OrgRoleRow = { id: string; key: string; name: string; rank: number };

/**
 * Validates that `roleId` names a real role of `organizationId` and
 * returns its rank + key, or `null` if it doesn't belong to this org (or
 * doesn't exist at all). Callers treat `null` the same as "cannot grant
 * this role" -- there's nothing a caller could ever be ranked high enough
 * to grant that isn't a real row.
 */
async function resolveOrgRole(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  roleId: string,
): Promise<OrgRoleRow | null> {
  const { data } = await supabase
    .from("organization_roles")
    .select("id, key, name, rank")
    .eq("id", roleId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data ?? null;
}

async function reauthOrError(): Promise<
  | { ok: true; ctx: AdminContext }
  | { ok: false; code: "reauth_required"; message: string; messageKey: string }
> {
  try {
    const proof = await requireReauth();
    return { ok: true, ctx: { actorUserId: proof.userId, correlationId: randomUUID() } };
  } catch (e) {
    if (e instanceof ReauthRequiredError) {
      return {
        ok: false,
        code: "reauth_required",
        message: e.message,
        messageKey: "errors.identity.common.reauthRequired",
      };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 1. createOrganization
// ---------------------------------------------------------------------------
export async function createOrganizationAction(
  rawInput: unknown,
): Promise<ActionResult<{ organizationId: string; slug: string }>> {
  const parsed = CreateOrganizationInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid organization input", undefined, parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first");

  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({
      slug: input.slug,
      name: input.name,
      legal_name: input.legalName ?? null,
      region: input.region ?? null,
      default_time_zone: input.defaultTimeZone,
      default_locale: input.defaultLocale,
      created_by: user.id,
    })
    .select("id, slug")
    .single();
  if (orgErr) {
    if (orgErr.code === "23505") return err("conflict", "Slug already taken");
    return err("internal", orgErr.message);
  }

  // Bootstrap the caller as the first `owner` of the new org.
  const { error: memberErr } = await supabase.from("organization_members").insert({
    organization_id: org.id,
    user_id: user.id,
    role: "owner",
    status: "active",
    invited_by: user.id,
  });
  if (memberErr) return err("internal", memberErr.message);

  const ctx = await ctxFor(user.id);
  await recordAudit(
    {
      organizationId: org.id,
      actorUserId: user.id,
      actorRole: "owner",
      eventType: "identity.organization_created",
      entityType: "organizations",
      entityId: org.id,
      after: { slug: org.slug, name: input.name },
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  revalidateTag("organizations", "max");
  return ok({ organizationId: org.id, slug: org.slug });
}

// ---------------------------------------------------------------------------
// 2. updateOrganizationSettings
// ---------------------------------------------------------------------------
export async function updateOrganizationSettingsAction(
  rawInput: unknown,
): Promise<ActionResult<{ organizationId: string }>> {
  const parsed = UpdateOrganizationInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "validation",
      "Invalid organization update",
      "errors.identity.organization.invalidUpdate",
      parsed.error.flatten().fieldErrors,
    );
  }
  const input = parsed.data;
  let member: Awaited<ReturnType<typeof requireOrgMember>>;
  try {
    member = await requireOrgMember(input.organizationId);
  } catch (e) {
    if (e instanceof PermissionError) return err("forbidden", e.message, "errors.identity.common.notMember");
    throw e;
  }
  if (!(await actorCan(member.role_id, "organization.settings.update"))) {
    return err(
      "forbidden",
      "Insufficient role to update organization settings",
      "errors.identity.organization.updateForbidden",
    );
  }
  const supabase = await createSupabaseServerClient();
  const before = await supabase
    .from("organizations")
    .select("name, legal_name, region, default_time_zone, default_locale, version")
    .eq("id", input.organizationId)
    .single();
  if (before.error) return err("internal", before.error.message, "errors.identity.common.internal");

  const updates: Record<string, unknown> = { version: (before.data.version ?? 0) + 1 };
  if (input.name !== undefined) updates.name = input.name;
  if (input.legalName !== undefined) updates.legal_name = input.legalName;
  if (input.region !== undefined) updates.region = input.region;
  if (input.defaultTimeZone !== undefined) updates.default_time_zone = input.defaultTimeZone;
  if (input.defaultLocale !== undefined) updates.default_locale = input.defaultLocale;

  const { error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", input.organizationId);
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  const ctx = await ctxFor(member.user_id);
  await recordAudit(
    {
      organizationId: input.organizationId,
      actorUserId: member.user_id,
      actorRole: member.role,
      eventType: "identity.organization_settings_changed",
      entityType: "organizations",
      entityId: input.organizationId,
      before: before.data,
      after: updates,
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  revalidatePath(`/[organizationSlug]/settings/organization`, "page");
  return ok({ organizationId: input.organizationId });
}

// ---------------------------------------------------------------------------
// 3. inviteUser
// ---------------------------------------------------------------------------
export async function inviteUserAction(
  rawInput: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  const parsed = InviteUserInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "validation",
      "Invalid invitation input",
      "errors.identity.invite.invalidInput",
      parsed.error.flatten().fieldErrors,
    );
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first", "errors.identity.common.unauthenticated");

  const { data: actor, error: actorErr } = await supabase
    .from("organization_members")
    .select("id, role, role_id, organization_id, organization_roles(rank)")
    .eq("organization_id", input.organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{
      id: string;
      role: string;
      role_id: string;
      organization_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (actorErr) return err("internal", actorErr.message, "errors.identity.common.internal");
  if (!actor) return err("forbidden", "Not a member of this organization", "errors.identity.common.notMember");
  if (!(await actorCan(actor.role_id, "membership.invite"))) {
    return err("forbidden", "Role cannot invite users", "errors.identity.invite.roleCannotInvite");
  }
  const targetRole = await resolveOrgRole(supabase, input.organizationId, input.roleId);
  const actorCanChangeRoles = await actorCan(actor.role_id, "membership.role.change");
  // Rank-only comparison isn't enough on its own: a rank tie (or, before
  // 20260901000003's DB-side rank cap, a corrupted/inflated rank) would let
  // a non-owner grant `owner`. The role's *key* must be checked directly --
  // only an existing owner may ever mint another one.
  if (
    !targetRole ||
    !canGrantRole(actor.organization_roles?.rank ?? 0, targetRole.rank, actorCanChangeRoles) ||
    (targetRole.key === "owner" && actor.role !== "owner")
  ) {
    return err(
      "forbidden",
      `Cannot grant role '${targetRole?.key ?? input.roleId}'`,
      "errors.identity.roles.cannotGrantRole",
      undefined,
      { role: targetRole?.key ?? input.roleId },
    );
  }

  const ctx = await ctxFor(user.id);
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  let created: { id: string; rawToken: string };
  try {
    created = await adminCreateInvitation(
      {
        organizationId: input.organizationId,
        email: input.email,
        role: targetRole.key,
        proposedScopes: input.scopes,
        invitedBy: user.id,
        expiresAt,
        clientOperationId: input.clientOperationId ?? null,
      },
      ctx,
    );
  } catch (e) {
    return err(
      "conflict",
      e instanceof Error ? e.message : "Failed to create invitation",
      e instanceof Error ? "errors.identity.invite.createFailed" : "errors.identity.invite.createFailedUnknown",
    );
  }

  await recordAudit(
    {
      organizationId: input.organizationId,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.user_invited",
      entityType: "invitations",
      entityId: created.id,
      after: { email: input.email, role: targetRole.key, expires_at: expiresAt },
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  // Email the raw token. Suppress email errors to the client; the
  // invitation is durable in the DB regardless of delivery status.
  try {
    const env = serverEnv();
    const { data: org } = await supabase
      .from("organizations")
      .select("name, default_locale")
      .eq("id", input.organizationId)
      .single();
    const { subject, html } = renderInvite({
      organizationName: org?.name ?? "AyamNorliza",
      inviterName: user.email ?? "A team member",
      role: targetRole.key,
      acceptUrl: `${env.INVITE_BASE_URL}/invite/${created.rawToken}`,
      expiresAt: new Date(expiresAt),
      locale: resolveLocale(org?.default_locale),
    });
    await sendEmail({ to: [input.email], subject, html });
  } catch {
    // Best-effort: the invitation can be resent.
  }

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ invitationId: created.id });
}

// ---------------------------------------------------------------------------
// 4. resendInvitation
// ---------------------------------------------------------------------------
export async function resendInvitationAction(
  rawInput: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  const parsed = ResendInvitationInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first", "errors.identity.common.unauthenticated");

  const { data: invitation } = await supabase
    .from("invitations")
    .select("id, organization_id, email, role, accepted_at, revoked_at")
    .eq("id", input.invitationId)
    .maybeSingle();
  if (!invitation) return err("not_found", "Invitation not found", "errors.identity.invite.notFound");
  if (invitation.accepted_at) return err("conflict", "Already accepted", "errors.identity.invite.alreadyAccepted");
  if (invitation.revoked_at) return err("conflict", "Revoked", "errors.identity.invite.revoked");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", invitation.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor || !(await actorCan(actor.role_id, "membership.invite"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }

  const ctx = await ctxFor(user.id);
  const newExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { rawToken } = await adminRotateInvitationToken(input.invitationId, newExpires, ctx);

  try {
    const env = serverEnv();
    const { data: org } = await supabase
      .from("organizations")
      .select("name, default_locale")
      .eq("id", invitation.organization_id)
      .single();
    const { subject, html } = renderInvite({
      organizationName: org?.name ?? "AyamNorliza",
      inviterName: user.email ?? "A team member",
      role: invitation.role,
      acceptUrl: `${env.INVITE_BASE_URL}/invite/${rawToken}`,
      expiresAt: new Date(newExpires),
      locale: resolveLocale(org?.default_locale),
    });
    await sendEmail({ to: [invitation.email], subject, html });
  } catch {
    // ignore
  }

  return ok({ invitationId: input.invitationId });
}

// ---------------------------------------------------------------------------
// 5. revokeInvitation
// ---------------------------------------------------------------------------
export async function revokeInvitationAction(
  rawInput: unknown,
): Promise<ActionResult<{ invitationId: string }>> {
  const parsed = RevokeInvitationInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first", "errors.identity.common.unauthenticated");

  const { data: invitation } = await supabase
    .from("invitations")
    .select("id, organization_id")
    .eq("id", input.invitationId)
    .maybeSingle();
  if (!invitation) return err("not_found", "Invitation not found", "errors.identity.invite.notFound");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", invitation.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor || !(await actorCan(actor.role_id, "membership.invite"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }

  const { error } = await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.invitationId);
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  const ctx = await ctxFor(user.id);
  await recordAudit(
    {
      organizationId: invitation.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.session_revoked",
      entityType: "invitations",
      entityId: input.invitationId,
      after: { revoked: true },
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ invitationId: input.invitationId });
}

// ---------------------------------------------------------------------------
// 6. acceptInvitation (called from /invite/[token] via the Edge Function
//    plus this server-side bootstrap. The Edge Function does the heavy
//    lifting via the admin client; this action is the typed wrapper used
//    by the page to set the display name and forward to the org.)
// ---------------------------------------------------------------------------
export async function acceptInvitationAction(
  rawInput: unknown,
): Promise<ActionResult<{ organizationId: string }>> {
  const parsed = AcceptInvitationInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  // The Edge Function `invitation-accept` does the auth.users / membership
  // work. Here we only forward and trigger a redirect on success; if
  // the Edge Function isn't reachable, we surface its error to the UI.
  const env = serverEnv();
  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/functions/v1/invitation-accept`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: env.SUPABASE_ANON_KEY },
      body: JSON.stringify({
        token_hash: hashTokenForClient(input.token),
        display_name: input.displayName,
        client_operation_id: input.clientOperationId,
      }),
    });
  } catch (e) {
    return err(
      "internal",
      e instanceof Error ? e.message : "Failed to call accept endpoint",
      "errors.identity.common.internal",
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "expired") return err("conflict", "Invitation expired", "errors.identity.invite.expired");
    if (body.error === "already_accepted") {
      return err("conflict", "Already accepted", "errors.identity.invite.alreadyAccepted");
    }
    if (body.error === "revoked") return err("conflict", "Revoked", "errors.identity.invite.revoked");
    return err(
      "internal",
      body.error ?? "Failed to accept invitation",
      "errors.identity.invite.acceptFailed",
    );
  }
  const data = (await res.json()) as { organization_id: string };
  return ok({ organizationId: data.organization_id });
}

// Hash the raw token on the client (browser) to send to the Edge
// Function. Mirrors `invite-token.ts:hashToken`; we keep it inline so
// the client does not need to import server-only code.
function hashTokenForClient(raw: string): string {
  // The Edge Function re-hashes on the server; the value here is a
  // base64url-encoded SHA-256 of the raw token. Done in the browser
  // via Web Crypto to keep parity with the server implementation.
  // Because the browser API is async, this function returns a string
  // and is intended to be called inside an async context where
  // SubtleCrypto is available; here we just import the function from
  // the lib.
  return hashTokenSync(raw);
}

function hashTokenSync(raw: string): string {
  // Server-side fallback (used when called from a non-browser context
  // such as a Server Action). In the browser the page wrapper does
  // the async SubtleCrypto dance; the Server Action path is
  // best-effort and only used for tests.
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(raw).digest("base64url");
}

// ---------------------------------------------------------------------------
// 7. changeMemberRole
// ---------------------------------------------------------------------------
export async function changeMemberRoleAction(
  rawInput: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth;

  const parsed = ChangeRoleInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: target } = await supabase
    .from("organization_members")
    .select("id, organization_id, role, user_id, organization_roles(rank)")
    .eq("id", input.memberId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      role: string;
      user_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!target) return err("not_found", "Member not found", "errors.identity.member.notFound");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id, organization_roles(rank)")
    .eq("organization_id", target.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{
      role: string;
      role_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!actor) return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  const actorCanChangeRoles = await actorCan(actor.role_id, "membership.role.change");
  if (!actorCanChangeRoles) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }
  // The actor must outrank (or match) the TARGET's *current* role too, not
  // just the role being granted -- otherwise an org_admin could reach down
  // and demote a member who currently holds a rank the org_admin could
  // never have been granted themselves (e.g. a corrupted/legacy row, or a
  // custom role ranked between org_admin and owner). Fails closed: an
  // unresolvable target rank is treated as "higher than anyone" (Infinity),
  // never as 0.
  //
  // Exempted when the target's *current* role is "owner": that case is
  // governed entirely by the second-owner-approval flow below (an
  // org_admin demoting an owner is the designed, tested bypass -- see the
  // "confirmed exploit path" comment further down), and this rank gate
  // would otherwise block it before it ever reaches that flow.
  if (
    target.role !== "owner" &&
    (actor.organization_roles?.rank ?? 0) < (target.organization_roles?.rank ?? Infinity)
  ) {
    return err(
      "forbidden",
      `Cannot manage member with role '${target.role}'`,
      "errors.identity.roles.cannotGrantRole",
      undefined,
      { role: target.role },
    );
  }
  const newRoleRow = await resolveOrgRole(supabase, target.organization_id, input.newRoleId);
  if (
    !newRoleRow ||
    !canGrantRole(actor.organization_roles?.rank ?? 0, newRoleRow.rank, actorCanChangeRoles)
  ) {
    return err(
      "forbidden",
      `Cannot grant role '${newRoleRow?.key ?? input.newRoleId}'`,
      "errors.identity.roles.cannotGrantRole",
      undefined,
      { role: newRoleRow?.key ?? input.newRoleId },
    );
  }
  if (((target as { role: string }).role) === newRoleRow.key) {
    return err("conflict", "Member already has that role", "errors.identity.member.alreadyHasRole");
  }
  // Plan §6: "high-risk changes require second approver". A change that
  // grants or revokes the `owner` role needs a second *owner* to approve
  // it — see the role-rank guard comment on `updateMemberProfileAction`
  // below ("the only path back is a second owner acting"). The approver
  // must be a real, active, distinct owner of this organization: passing
  // any non-empty `approverUserId` must never be sufficient.
  const targetRole: string = (target as { role: string }).role;
  const newRole: string = newRoleRow.key;
  const isOwnerChange = newRole === "owner" || (targetRole === "owner" && newRole !== "owner");
  if (isOwnerChange) {
    let approver: { role: string } | null = null;
    if (input.approverUserId && input.approverUserId !== user.id) {
      const { data } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", target.organization_id)
        .eq("user_id", input.approverUserId)
        .eq("status", "active")
        .maybeSingle();
      approver = data as { role: string } | null;
    }
    if (!approver || approver.role !== "owner") {
      return err("forbidden", "Owner changes require a second approver", "errors.identity.member.ownerNeedsApprover");
    }
  }

  const { data: updated, error } = await supabase
    .from("organization_members")
    .update({ role_id: newRoleRow.id })
    .eq("id", input.memberId)
    .select("id, role")
    .single();
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  await recordAudit(
    {
      organizationId: target.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.role_changed",
      entityType: "organization_members",
      entityId: updated.id,
      before: { role: target.role },
      after: {
        role: updated.role,
        ...(isOwnerChange && input.approverUserId ? { approver_user_id: input.approverUserId } : {}),
      },
      reason: input.reason,
      correlationId: reauth.ctx.correlationId,
      source: "web",
    },
    reauth.ctx,
  );

  await dispatch({
    event: "identity.role_changed",
    organizationId: target.organization_id,
    recipients: [target.user_id],
    data: { from: target.role, to: updated.role, reason: input.reason },
  });

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ memberId: updated.id });
}

// ---------------------------------------------------------------------------
// 8. changeMemberScope
// ---------------------------------------------------------------------------
export async function changeMemberScopeAction(
  rawInput: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth;

  const parsed = ChangeScopeInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: target } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id")
    .eq("id", input.memberId)
    .maybeSingle();
  if (!target) return err("not_found", "Member not found", "errors.identity.member.notFound");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", target.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor || !(await actorCan(actor.role_id, "membership.scope.change"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }

  // Replace the scope set in a transaction-like sequence: delete old,
  // insert new. RLS will deny if any new row has a permission broader
  // than the actor's own role.
  const { error: deleteErr } = await supabase
    .from("member_scopes")
    .delete()
    .eq("organization_member_id", target.id);
  if (deleteErr) return err("internal", deleteErr.message, "errors.identity.common.internal");

  if (input.scopes.length > 0) {
    const { error: insertErr } = await supabase.from("member_scopes").insert(
      input.scopes.map((s) => ({
        organization_member_id: target.id,
        organization_id: target.organization_id,
        site_id: s.siteId ?? null,
        zone_id: s.zoneId ?? null,
        house_id: s.houseId ?? null,
        permission: s.permission ?? null,
        expires_at: s.expiresAt ?? null,
      })),
    );
    if (insertErr) return err("internal", insertErr.message, "errors.identity.common.internal");
  }

  await recordAudit(
    {
      organizationId: target.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.scope_changed",
      entityType: "organization_members",
      entityId: target.id,
      before: null,
      after: { scopes: input.scopes },
      reason: input.reason,
      correlationId: reauth.ctx.correlationId,
      source: "web",
    },
    reauth.ctx,
  );

  await dispatch({
    event: "identity.scope_changed",
    organizationId: target.organization_id,
    recipients: [target.user_id],
    data: { scopes: input.scopes, reason: input.reason },
  });

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ memberId: target.id });
}

// ---------------------------------------------------------------------------
// 9. deactivateUser
// ---------------------------------------------------------------------------
export async function deactivateUserAction(
  rawInput: unknown,
): Promise<ActionResult<{ userId: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth;

  const parsed = DeactivateUserInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: target } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id, role, status, organization_roles(rank)")
    .eq("id", input.memberId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      user_id: string;
      role: string;
      status: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!target) return err("not_found", "Member not found", "errors.identity.member.notFound");
  if ((target.role as string) === "owner" && target.status === "active") {
    return err(
      "forbidden",
      "Transfer ownership before deactivating the owner",
      "errors.identity.member.transferOwnershipFirst",
    );
  }

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id, organization_roles(rank)")
    .eq("organization_id", target.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{
      role: string;
      role_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!actor || !(await actorCan(actor.role_id, "membership.deactivate"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }
  // The active-owner case is already blocked flatly above regardless of
  // rank, so this only ever gates a non-owner target: the actor must
  // outrank (or match) the target's current role. Fails closed -- an
  // unresolvable target rank reads as "higher than anyone" (Infinity).
  if ((actor.organization_roles?.rank ?? 0) < (target.organization_roles?.rank ?? Infinity)) {
    return err(
      "forbidden",
      `Cannot manage member with role '${target.role}'`,
      "errors.identity.roles.cannotGrantRole",
      undefined,
      { role: target.role },
    );
  }

  const { error: memberErr } = await supabase
    .from("organization_members")
    .update({ status: "suspended" })
    .eq("id", target.id);
  if (memberErr) return err("internal", memberErr.message, "errors.identity.common.internal");
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ status: "inactive" })
    .eq("user_id", target.user_id);
  if (profileErr) return err("internal", profileErr.message, "errors.identity.common.internal");

  await adminRevokeUserSessions(target.user_id, input.reason, reauth.ctx);

  await recordAudit(
    {
      organizationId: target.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.user_deactivated",
      entityType: "organization_members",
      entityId: target.id,
      before: { status: "active" },
      after: { status: "suspended", reason: input.reason, transfer_to: input.transferToMemberId ?? null },
      reason: input.reason,
      correlationId: reauth.ctx.correlationId,
      source: "web",
    },
    reauth.ctx,
  );

  await dispatch({
    event: "identity.user_deactivated",
    organizationId: target.organization_id,
    recipients: [target.user_id],
    priority: "high",
    data: { reason: input.reason },
  });

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ userId: target.user_id });
}

// ---------------------------------------------------------------------------
// updateMemberProfile
// ---------------------------------------------------------------------------
export async function updateMemberProfileAction(
  rawInput: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth;

  const parsed = UpdateMemberProfileInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: target } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id, role, role_id, organization_roles(rank)")
    .eq("id", input.memberId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      user_id: string;
      role: string;
      role_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!target) return err("not_found", "Member not found", "errors.identity.member.notFound");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id, organization_roles(rank)")
    .eq("organization_id", target.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{
      role: string;
      role_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!actor) return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  const actorCanChangeRoles = await actorCan(actor.role_id, "membership.role.change");
  if (!actorCanChangeRoles) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }
  // Role-rank guard: an org_admin must never edit the identity (email!)
  // of a member who outranks them — an owner-email swap plus a password
  // reset would be a full owner-account takeover, bypassing the
  // two-person owner rule enforced elsewhere. Fails closed on the target
  // side: an unresolvable target rank reads as Infinity (deny), never 0
  // (which would read as "lowest possible rank" and wrongly allow it).
  if (
    !canGrantRole(actor.organization_roles?.rank ?? 0, target.organization_roles?.rank ?? Infinity, actorCanChangeRoles)
  ) {
    return err(
      "forbidden",
      `Cannot manage member with role '${target.role}'`,
      "errors.identity.roles.cannotGrantRole",
      undefined,
      { role: target.role },
    );
  }

  try {
    await adminUpdateMemberIdentity(
      { userId: target.user_id, displayName: input.displayName, email: input.email },
      reauth.ctx,
    );
  } catch (e) {
    const isDuplicate =
      typeof e === "object" && e !== null &&
      (("code" in e && (e as { code?: string }).code === "email_exists") ||
        ("status" in e && (e as { status?: number }).status === 422));
    if (isDuplicate) {
      return err("conflict", "Email already in use", "errors.identity.member.emailInUse", {
        email: ["errors.identity.member.emailInUse"],
      });
    }
    return err("internal", e instanceof Error ? e.message : "Update failed", "errors.identity.member.updateFailed");
  }

  await recordAudit(
    {
      organizationId: target.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.member_profile_updated",
      entityType: "organization_members",
      entityId: target.id,
      after: {
        ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
      },
      reason: input.reason,
      correlationId: reauth.ctx.correlationId,
      source: "web",
    },
    reauth.ctx,
  );

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ memberId: target.id });
}

// ---------------------------------------------------------------------------
// removeMember (remove from organization; auth account survives)
// ---------------------------------------------------------------------------
export async function removeMemberAction(
  rawInput: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth;

  const parsed = RemoveMemberInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: target } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id, role, status, organization_roles(rank)")
    .eq("id", input.memberId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      user_id: string;
      role: string;
      status: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!target) return err("not_found", "Member not found", "errors.identity.member.notFound");
  if (target.user_id === user.id) {
    return err("forbidden", "You cannot remove yourself", "errors.identity.member.cannotRemoveSelf");
  }
  if ((target.role as string) === "owner" && target.status === "active") {
    return err(
      "forbidden",
      "Transfer ownership before removing the owner",
      "errors.identity.member.transferOwnershipFirst",
    );
  }

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id, organization_roles(rank)")
    .eq("organization_id", target.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{
      role: string;
      role_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (!actor || !(await actorCan(actor.role_id, "membership.deactivate"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }
  // The active-owner case is already blocked flatly above regardless of
  // rank, so this only ever gates a non-owner target: the actor must
  // outrank (or match) the target's current role. Fails closed -- an
  // unresolvable target rank reads as "higher than anyone" (Infinity).
  if ((actor.organization_roles?.rank ?? 0) < (target.organization_roles?.rank ?? Infinity)) {
    return err(
      "forbidden",
      `Cannot manage member with role '${target.role}'`,
      "errors.identity.roles.cannotGrantRole",
      undefined,
      { role: target.role },
    );
  }

  try {
    await adminDeleteOrgMember(target.id, reauth.ctx);
  } catch (e) {
    return err("internal", e instanceof Error ? e.message : "Remove failed", "errors.identity.member.removeFailed");
  }

  await adminRevokeUserSessions(target.user_id, input.reason, reauth.ctx);

  await recordAudit(
    {
      organizationId: target.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.user_removed",
      entityType: "organization_members",
      entityId: target.id,
      before: { role: target.role, status: target.status },
      after: null,
      reason: input.reason,
      correlationId: reauth.ctx.correlationId,
      source: "web",
    },
    reauth.ctx,
  );

  await dispatch({
    event: "identity.user_removed",
    organizationId: target.organization_id,
    recipients: [target.user_id],
    priority: "high",
    data: { reason: input.reason },
  });

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ memberId: target.id });
}

// ---------------------------------------------------------------------------
// sendPasswordReset (admin-triggered recovery email; no reauth needed)
// ---------------------------------------------------------------------------
export async function sendPasswordResetAction(
  rawInput: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const parsed = SendPasswordResetInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: target } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id")
    .eq("id", input.memberId)
    .maybeSingle();
  if (!target) return err("not_found", "Member not found", "errors.identity.member.notFound");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", target.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor || !(await actorCan(actor.role_id, "membership.invite"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }

  const emails = await adminGetMemberEmails([target.user_id]);
  const email = emails.get(target.user_id);
  if (!email) return err("conflict", "Member has no email", "errors.identity.member.noEmail");

  // Admin-triggered reset: `resetPasswordForEmail` on this cookie-backed
  // PKCE client would bind the code_verifier to the ADMIN's browser, so
  // the link would always fail in the TARGET's browser. Instead generate
  // a recovery token_hash (service role) and email a `/auth/confirm`
  // link the target's own browser can verify via `verifyOtp`.
  const env = serverEnv();
  try {
    const { hashedToken } = await admin.generateRecoveryLink(email);
    const { data: org } = await supabase
      .from("organizations")
      .select("name, default_locale")
      .eq("id", target.organization_id)
      .single();
    const { subject, html } = renderPasswordReset({
      organizationName: org?.name ?? "AyamNorliza",
      resetUrl: `${env.INVITE_BASE_URL}/auth/confirm?token_hash=${hashedToken}&type=recovery&next=/set-password`,
      locale: resolveLocale(org?.default_locale),
    });
    await sendEmail({ to: [email], subject, html });
  } catch (e) {
    return err(
      "internal",
      e instanceof Error ? e.message : "Could not send the reset email",
      "errors.identity.member.resetFailed",
    );
  }

  const ctx = await ctxFor(user.id);
  await admin.insertAuthSecurityEvent(
    {
      userId: target.user_id,
      organizationId: target.organization_id,
      eventType: "password_reset",
      ip: null,
      userAgent: null,
      geoCountry: null,
      metadata: { triggered_by: user.id },
    },
    ctx,
  );
  await recordAudit(
    {
      organizationId: target.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.password_reset_sent",
      entityType: "organization_members",
      entityId: target.id,
      after: { email_sent: true },
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  return ok({ memberId: target.id });
}

// ---------------------------------------------------------------------------
// createUser (direct account creation; user sets password via reset email)
// ---------------------------------------------------------------------------
export async function createUserAction(
  rawInput: unknown,
): Promise<ActionResult<{ userId: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth;

  const parsed = CreateUserInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first", "errors.identity.common.unauthenticated");

  const { data: actor, error: actorErr } = await supabase
    .from("organization_members")
    .select("id, role, role_id, organization_roles(rank)")
    .eq("organization_id", input.organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{
      id: string;
      role: string;
      role_id: string;
      organization_roles: { rank: number } | null;
    }>();
  if (actorErr) return err("internal", actorErr.message, "errors.identity.common.internal");
  if (!actor) return err("forbidden", "Not a member of this organization", "errors.identity.common.notMember");
  if (!(await actorCan(actor.role_id, "membership.invite"))) {
    return err("forbidden", "Role cannot create users", "errors.identity.invite.roleCannotInvite");
  }
  const targetRole = await resolveOrgRole(supabase, input.organizationId, input.roleId);
  const actorCanChangeRoles = await actorCan(actor.role_id, "membership.role.change");
  // See the identical guard in inviteUserAction: rank alone can't gate an
  // owner grant, the role's key must be checked -- only an owner may mint
  // another owner.
  if (
    !targetRole ||
    !canGrantRole(actor.organization_roles?.rank ?? 0, targetRole.rank, actorCanChangeRoles) ||
    (targetRole.key === "owner" && actor.role !== "owner")
  ) {
    return err(
      "forbidden",
      `Cannot grant role '${targetRole?.key ?? input.roleId}'`,
      "errors.identity.roles.cannotGrantRole",
      undefined,
      { role: targetRole?.key ?? input.roleId },
    );
  }

  let created: { userId: string };
  try {
    created = await adminCreateOrgUser(
      {
        organizationId: input.organizationId,
        email: input.email,
        displayName: input.displayName,
        role: targetRole.key,
        invitedBy: user.id,
      },
      reauth.ctx,
    );
  } catch (e) {
    const isDuplicate =
      typeof e === "object" && e !== null &&
      (("code" in e && (e as { code?: string }).code === "email_exists") ||
        ("status" in e && (e as { status?: number }).status === 422));
    if (isDuplicate) {
      return err("conflict", "Email already registered", "errors.identity.user.emailInUse", {
        email: ["errors.identity.user.emailInUse"],
      });
    }
    return err("internal", e instanceof Error ? e.message : "Create failed", "errors.identity.user.createFailed");
  }

  await recordAudit(
    {
      organizationId: input.organizationId,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.user_created",
      entityType: "organization_members",
      entityId: created.userId,
      after: { email: input.email, display_name: input.displayName, role: targetRole.key },
      correlationId: reauth.ctx.correlationId,
      source: "web",
    },
    reauth.ctx,
  );

  // Set-password email; best-effort (admin can trigger a reset later).
  // Same admin-reset pattern as sendPasswordResetAction: a recovery
  // token_hash link works in the new user's browser, where a PKCE
  // `resetPasswordForEmail` from this admin-scoped client would not.
  try {
    const env = serverEnv();
    const { hashedToken } = await admin.generateRecoveryLink(input.email);
    const { data: org } = await supabase
      .from("organizations")
      .select("name, default_locale")
      .eq("id", input.organizationId)
      .single();
    const { subject, html } = renderPasswordReset({
      organizationName: org?.name ?? "AyamNorliza",
      resetUrl: `${env.INVITE_BASE_URL}/auth/confirm?token_hash=${hashedToken}&type=recovery&next=/set-password`,
      locale: resolveLocale(org?.default_locale),
    });
    await sendEmail({ to: [input.email], subject, html });
  } catch {
    // Durable account exists regardless of delivery.
  }

  revalidatePath(`/[organizationSlug]/settings/users`, "page");
  return ok({ userId: created.userId });
}

// ---------------------------------------------------------------------------
// 10. startAccessReview
// ---------------------------------------------------------------------------
export async function startAccessReviewAction(
  rawInput: unknown,
): Promise<ActionResult<{ reviewId: string }>> {
  const parsed = StartAccessReviewInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();
  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor || !(await actorCan(actor.role_id, "access_review.run"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }

  const { data: review, error } = await supabase
    .from("access_reviews")
    .insert({
      organization_id: input.organizationId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      reviewer_id: input.reviewerId,
      due_at: input.dueAt,
      status: "open",
    })
    .select("id")
    .single();
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  // One item per active member in scope, excluding the actor: reviewers do
  // not review their own access, and `access_review_items_admin_write`
  // rejects a self-referencing item (which would fail the whole batch).
  const { data: members } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("status", "active")
    .neq("user_id", user.id);
  if (members && members.length > 0) {
    const { error: itemErr } = await supabase.from("access_review_items").insert(
      members.map((m) => ({
        access_review_id: review.id,
        organization_member_id: m.id,
        decision: "pending" as const,
      })),
    );
    if (itemErr) return err("internal", itemErr.message, "errors.identity.common.internal");
  }

  const ctx = await ctxFor(user.id);
  await recordAudit(
    {
      organizationId: input.organizationId,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.access_review_started",
      entityType: "access_reviews",
      entityId: review.id,
      after: { period_start: input.periodStart, period_end: input.periodEnd, due_at: input.dueAt },
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  revalidatePath(`/[organizationSlug]/settings/access-reviews`, "page");
  return ok({ reviewId: review.id });
}

// ---------------------------------------------------------------------------
// 11. decideReviewItem
// ---------------------------------------------------------------------------
export async function decideReviewItemAction(
  rawInput: unknown,
): Promise<ActionResult<{ itemId: string }>> {
  const parsed = DecideReviewItemInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: item } = await supabase
    .from("access_review_items")
    .select("id, access_review_id, organization_member_id, decision")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!item) return err("not_found", "Review item not found", "errors.identity.accessReview.itemNotFound");

  const { data: review } = await supabase
    .from("access_reviews")
    .select("id, organization_id")
    .eq("id", item.access_review_id)
    .single();
  if (!review) return err("not_found", "Review not found", "errors.identity.accessReview.reviewNotFound");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", review.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor || !(await actorCan(actor.role_id, "access_review.decide"))) {
    return err("forbidden", "Insufficient role", "errors.identity.common.forbidden");
  }

  const { error } = await supabase
    .from("access_review_items")
    .update({
      decision: input.decision,
      decision_reason: input.decisionReason ?? null,
      evidence: input.evidence,
      decided_at: new Date().toISOString(),
      decided_by: user.id,
    })
    .eq("id", input.itemId);
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  // If decision is `revoke`, suspend the underlying member.
  if (input.decision === "revoke") {
    const { error: suspendErr } = await supabase
      .from("organization_members")
      .update({ status: "suspended" })
      .eq("id", item.organization_member_id);
    if (suspendErr) return err("internal", suspendErr.message, "errors.identity.common.internal");
  }

  const ctx = await ctxFor(user.id);
  await recordAudit(
    {
      organizationId: review.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.access_review_decided",
      entityType: "access_review_items",
      entityId: input.itemId,
      before: { decision: item.decision },
      after: { decision: input.decision, reason: input.decisionReason ?? null },
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  return ok({ itemId: input.itemId });
}

// ---------------------------------------------------------------------------
// 14. openBreakGlass
// ---------------------------------------------------------------------------
export async function openBreakGlassAction(
  rawInput: unknown,
): Promise<ActionResult<{ eventId: string; expiresAt: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth;

  const parsed = OpenBreakGlassInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor) return err("forbidden", "Not a member of this organization", "errors.identity.common.notMember");
  if (!(await actorCan(actor.role_id, "break_glass.open"))) {
    return err("forbidden", "Role cannot open break-glass", "errors.identity.breakGlass.cannotOpen");
  }

  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + input.durationMinutes * 60 * 1000);

  const { data: event, error } = await supabase
    .from("break_glass_events")
    .insert({
      organization_id: input.organizationId,
      user_id: user.id,
      reason: input.reason,
      ticket_reference: input.ticketReference ?? null,
      approved_by: input.approvedBy ?? null,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id, expires_at")
    .single();
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  await recordAudit(
    {
      organizationId: input.organizationId,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.break_glass_used",
      entityType: "break_glass_events",
      entityId: event.id,
      after: {
        reason: input.reason,
        ticket_reference: input.ticketReference ?? null,
        expires_at: event.expires_at,
      },
      reason: input.reason,
      correlationId: reauth.ctx.correlationId,
      source: "web",
    },
    reauth.ctx,
  );

  // Notify owners + security contact within 60 seconds.
  const { data: owners } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", input.organizationId)
    .eq("role", "owner")
    .eq("status", "active");
  const ownerRecipients = (owners ?? []).map((o) => o.user_id);
  if (ownerRecipients.length > 0) {
    await dispatch({
      event: "identity.break_glass_used",
      organizationId: input.organizationId,
      recipients: ownerRecipients,
      priority: "high",
      data: {
        user: user.id,
        reason: input.reason,
        ticket_reference: input.ticketReference ?? null,
        expires_at: event.expires_at,
      },
    });
    // Email copy is rendered separately for owners; we keep dispatch()
    // generic and call the templated email directly here.
    const env = serverEnv();
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", input.organizationId)
      .single();
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    // Owners can each have their own `profiles.locale`; group them so
    // every owner gets the email in their own language instead of
    // widening the query beyond the locale column.
    const { data: ownerProfiles } = await supabase
      .from("profiles")
      .select("user_id, locale")
      .in("user_id", ownerRecipients);
    // Membership rows only carry user ids — emails live on `auth.users`,
    // so resolve them through the service-role client before sending.
    const ownerEmails = await admin.getUserEmailsByIds(ownerRecipients);
    const localeGroups = groupOwnerEmailsByLocale(
      ownerRecipients.map((uid) => ({
        userId: uid,
        email: ownerEmails.get(uid) ?? null,
        locale: ownerProfiles?.find((p) => p.user_id === uid)?.locale,
      })),
    );
    for (const [locale, recipients] of localeGroups) {
      const { subject, html } = renderBreakGlassUsed({
        organizationName: org?.name ?? "AyamNorliza",
        userEmail: profile?.display_name ?? user.email ?? "unknown",
        reason: input.reason,
        ticketReference: input.ticketReference ?? null,
        expiresAt,
        locale,
      });
      await sendEmail({ to: recipients, subject, html });
    }
    void env; // referenced for future SMTP fallback
  }

  return ok({ eventId: event.id, expiresAt: event.expires_at });
}

// ---------------------------------------------------------------------------
// 15a. endBreakGlass
// ---------------------------------------------------------------------------
export async function endBreakGlassAction(
  rawInput: unknown,
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = EndBreakGlassInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid input", undefined, parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: event } = await supabase
    .from("break_glass_events")
    .select("id, organization_id, user_id, ended_at")
    .eq("id", input.eventId)
    .maybeSingle();
  if (!event) return err("not_found", "Event not found");
  if (event.ended_at) return err("conflict", "Already ended");
  if (event.user_id !== user.id) return err("forbidden", "Only the breaker can end this event");

  const { error } = await supabase
    .from("break_glass_events")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", input.eventId);
  if (error) return err("internal", error.message);

  const ctx = await ctxFor(user.id);
  await recordAudit(
    {
      organizationId: event.organization_id,
      actorUserId: user.id,
      eventType: "identity.break_glass_used",
      entityType: "break_glass_events",
      entityId: input.eventId,
      after: { ended_at: new Date().toISOString() },
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );
  return ok({ eventId: input.eventId });
}

// ---------------------------------------------------------------------------
// 15b. finalizeBreakGlassReview
// ---------------------------------------------------------------------------
export async function finalizeBreakGlassReviewAction(
  rawInput: unknown,
): Promise<ActionResult<{ eventId: string }>> {
  const parsed = FinalizeBreakGlassReviewInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid input", undefined, parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser();

  const { data: event } = await supabase
    .from("break_glass_events")
    .select("id, organization_id, ended_at")
    .eq("id", input.eventId)
    .maybeSingle();
  if (!event) return err("not_found", "Event not found");
  if (!event.ended_at) return err("conflict", "End the event before finalizing the review");

  const { data: actor } = await supabase
    .from("organization_members")
    .select("role, role_id")
    .eq("organization_id", event.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!actor || !(await actorCan(actor.role_id, "break_glass.finalize"))) {
    return err("forbidden", "Only owners can finalize a break-glass review");
  }

  const { error } = await supabase
    .from("break_glass_events")
    .update({ post_use_review: input.postUseReview })
    .eq("id", input.eventId);
  if (error) return err("internal", error.message);

  const ctx = await ctxFor(user.id);
  await recordAudit(
    {
      organizationId: event.organization_id,
      actorUserId: user.id,
      actorRole: actor.role,
      eventType: "identity.break_glass_review_finalized",
      entityType: "break_glass_events",
      entityId: input.eventId,
      after: input.postUseReview,
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );
  return ok({ eventId: input.eventId });
}

// All exports above are async Server Actions.
