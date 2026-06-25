/**
 * Admin-typed queries.
 *
 * These run against the service-role client and bypass RLS. They are
 * therefore restricted to a small, named set of operations that the
 * plan explicitly carves out:
 *
 *   - sign-out-everywhere (session revocation on deactivation)
 *   - accept-invitation (creates auth.users on first sign-up)
 *   - audit/security event inserts
 *
 * The functions in this file MUST be called from Server Actions or
 * Edge Functions; they refuse to run if the calling context is not
 * server-only. Each function takes an `AdminContext` with the actor
 * identity and a correlation id so the audit trail is attributable.
 */

import "server-only";

import { admin, type AdminContext } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { newInvitationToken } from "@/lib/auth/invite-token";

export type CreateInvitationRow = {
  organizationId: string;
  email: string;
  role: string;
  proposedScopes: unknown;
  invitedBy: string;
  expiresAt: string;
  clientOperationId: string | null;
};

/**
 * Insert a new invitation. Returns the raw token (to be placed in the
 * email) and the stored row id. The DB row contains only the hash.
 */
export async function adminCreateInvitation(
  input: CreateInvitationRow,
  _ctx: AdminContext,
): Promise<{ id: string; rawToken: string }> {
  const { raw, hash } = newInvitationToken();
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invitations")
    .insert({
      organization_id: input.organizationId,
      email: input.email,
      role: input.role,
      proposed_scopes: input.proposedScopes,
      token_hash: hash,
      invited_by: input.invitedBy,
      expires_at: input.expiresAt,
      client_operation_id: input.clientOperationId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, rawToken: raw };
}

/**
 * Rotate the token of an existing, unrevoked, unaccepted invitation.
 */
export async function adminRotateInvitationToken(
  invitationId: string,
  newExpiresAt: string,
  _ctx: AdminContext,
): Promise<{ rawToken: string }> {
  const { raw, hash } = newInvitationToken();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("invitations")
    .update({ token_hash: hash, expires_at: newExpiresAt })
    .eq("id", invitationId)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (error) throw error;
  return { rawToken: raw };
}

/**
 * Revoke all active sessions for a user, used on deactivation. Wraps
 * `admin.revokeUserSessions` and writes the corresponding audit event.
 */
export async function adminRevokeUserSessions(
  userId: string,
  reason: string,
  ctx: AdminContext,
): Promise<void> {
  await admin.revokeUserSessions(userId, ctx);
  await admin.insertAuthSecurityEvent(
    {
      userId,
      organizationId: null,
      eventType: "session_revoke",
      ip: null,
      userAgent: null,
      geoCountry: null,
      metadata: { reason, by: ctx.actorUserId },
    },
    ctx,
  );
  await admin.insertAuditEvent(
    {
      organizationId: null,
      actorUserId: ctx.actorUserId,
      actorRole: null,
      eventType: "identity.session_revoked",
      entityType: "auth.users",
      entityId: userId,
      before: null,
      after: { revoked: true, reason },
      reason,
      correlationId: ctx.correlationId,
      clientOperationId: null,
      source: "web",
    },
    ctx,
  );
}
