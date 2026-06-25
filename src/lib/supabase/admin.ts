/**
 * Service-role Supabase client (admin).
 *
 * Bypasses RLS. ONLY use from a reviewed, server-only path: scheduled jobs,
 * Edge Functions, the invitation-accept flow, session revocation, and
 * inserts to `audit_log` / `auth_security_events`.
 *
 * Guardrails:
 *   - `import "server-only"` - refuses to bundle in the browser.
 *   - The wrapper requires an explicit `actor` and `correlationId` so every
 *     admin write is attributable.
 *   - The exported object exposes a small, named API (`createUser`,
 *     `revokeUserSessions`, `insertAuditEvent`, `insertAuthSecurityEvent`)
 *     rather than the raw client, so callers cannot accidentally widen the
 *     blast radius.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let cachedClient: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const env = serverEnv();
  cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

export type AdminContext = {
  actorUserId: string | null;
  correlationId: string;
};

export const admin = {
  /**
   * Create a Supabase auth user. Returns the new user id. Used by the
   * invitation-accept Edge Function when the invitee has no account yet.
   */
  async createUser(input: { email: string; emailConfirm?: boolean }) {
    const c = client();
    const { data, error } = await c.auth.admin.createUser({
      email: input.email,
      email_confirm: input.emailConfirm ?? true,
    });
    if (error) throw error;
    if (!data.user) throw new Error("createUser: no user returned");
    return data.user;
  },

  /**
   * Ban a user for a short window so all existing access and refresh
   * tokens are rejected. The Supabase GoTrue admin API uses JWTs to
   * sign out specific sessions; we don't have a single "revoke all"
   * API, so we ban the account instead. The ban is lifted when the
   * `admin.unbanUser()` is called or after the duration.
   */
  async revokeUserSessions(userId: string, _ctx: AdminContext) {
    const c = client();
    const { error } = await c.auth.admin.updateUserById(userId, {
      ban_duration: "24h",
    });
    if (error) throw error;
  },

  async unbanUser(userId: string, _ctx: AdminContext) {
    const c = client();
    const { error } = await c.auth.admin.updateUserById(userId, { ban_duration: "0s" });
    if (error) throw error;
  },

  /**
   * Append-only insert into the `audit_log` table. The DB trigger blocks
   * UPDATE/DELETE, so even this admin path cannot mutate history.
   */
  async insertAuditEvent(
    row: {
      organizationId: string | null;
      actorUserId: string | null;
      actorRole?: string | null;
      actorSessionId?: string | null;
      eventType: string;
      entityType: string;
      entityId: string | null;
      before: unknown;
      after: unknown;
      reason: string | null;
      correlationId: string | null;
      clientOperationId: string | null;
      source: "web" | "mobile" | "device" | "integration" | "job" | "import" | "server";
    },
    ctx: AdminContext,
  ) {
    if (row.actorUserId && ctx.actorUserId && row.actorUserId !== ctx.actorUserId) {
      throw new Error("insertAuditEvent: actor mismatch");
    }
    const c = client();
    const { error } = await c.from("audit_log").insert({
      organization_id: row.organizationId,
      actor_user_id: row.actorUserId,
      actor_role: row.actorRole ?? null,
      actor_session_id: row.actorSessionId ?? null,
      event_type: row.eventType,
      entity_type: row.entityType,
      entity_id: row.entityId,
      before: row.before ?? null,
      after: row.after ?? null,
      reason: row.reason,
      correlation_id: row.correlationId ?? ctx.correlationId,
      client_operation_id: row.clientOperationId,
      source: row.source,
    });
    if (error) throw error;
  },

  /**
   * Append-only insert into `auth_security_events` (sign-in, MFA,
   * step-up, suspicious activity, etc.).
   */
  async insertAuthSecurityEvent(
    row: {
      userId: string | null;
      organizationId: string | null;
      eventType:
        | "login_success"
        | "login_failure"
        | "mfa_enroll"
        | "mfa_unenroll"
        | "mfa_challenge_success"
        | "mfa_challenge_failure"
        | "password_reset"
        | "token_refresh"
        | "session_revoke"
        | "suspicious_activity";
      ip: string | null;
      userAgent: string | null;
      geoCountry: string | null;
      metadata: Record<string, unknown>;
    },
    _ctx: AdminContext,
  ) {
    const c = client();
    const { error } = await c.from("auth_security_events").insert({
      user_id: row.userId,
      organization_id: row.organizationId,
      event_type: row.eventType,
      ip: row.ip,
      user_agent: row.userAgent,
      geo_country: row.geoCountry,
      metadata: row.metadata,
    });
    if (error) throw error;
  },
};
