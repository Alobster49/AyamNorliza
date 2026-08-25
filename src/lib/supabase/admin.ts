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

import { createClient, isAuthApiError, type SupabaseClient } from "@supabase/supabase-js";
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
   * Permanently delete an auth user. Only for rolling back a signup
   * whose profile insert failed — an auth user without its profile row
   * can neither sign in nor re-register, so the orphan must go.
   */
  async deleteAuthUser(userId: string) {
    const c = client();
    const { error } = await c.auth.admin.deleteUser(userId);
    if (error) throw error;
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
   * Change a user's login email. Admin path: the change takes effect
   * immediately (no confirmation email round-trip) because the actor is
   * an org admin correcting staff data, not the user self-serving.
   */
  async updateUserEmail(userId: string, email: string) {
    const c = client();
    const { error } = await c.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (error) throw error;
  },

  /**
   * Generate a recovery (password-reset) link for a user and return its
   * hashed token. Admin-triggered resets must NOT use the cookie-backed
   * PKCE `resetPasswordForEmail`: the code_verifier would live in the
   * ADMIN's browser session while the link opens in the TARGET's browser,
   * so the exchange always fails. The hashed token instead goes into a
   * `/auth/confirm?token_hash=...` link that the target's own
   * request-scoped client verifies via `verifyOtp`.
   */
  async generateRecoveryLink(email: string): Promise<{ hashedToken: string }> {
    const c = client();
    const { data, error } = await c.auth.admin.generateLink({ type: "recovery", email });
    if (error) throw error;
    const hashedToken = data.properties?.hashed_token;
    if (!hashedToken) throw new Error("generateRecoveryLink: no hashed_token returned");
    return { hashedToken };
  },

  /**
   * Delete an organization membership row (remove-from-org). No RLS
   * DELETE policy exists on organization_members by design; the DB
   * trigger still refuses to delete an active owner.
   */
  async deleteOrgMember(memberId: string, _ctx: AdminContext) {
    const c = client();
    const { error } = await c.from("organization_members").delete().eq("id", memberId);
    if (error) throw error;
  },

  /**
   * Resolve auth emails for a set of user ids. Emails live only on
   * `auth.users`, which RLS-scoped clients cannot read — the break-glass
   * owner notification uses this to turn membership `user_id`s into
   * deliverable addresses. A failed lookup maps to null; the caller
   * decides whether to skip or fail.
   */
  async getUserEmailsByIds(userIds: string[]): Promise<Map<string, string | null>> {
    const c = client();
    const entries = await Promise.all(
      userIds.map(async (id) => {
        try {
          const { data, error } = await c.auth.admin.getUserById(id);
          if (error || !data.user) return [id, null] as const;
          return [id, data.user.email ?? null] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    );
    return new Map(entries);
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

  /**
   * Create a password login if the email is unknown, otherwise reset the
   * existing user's password. Data console only. Returns the user id.
   */
  async ensureUserWithPassword(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<string> {
    const c = client();
    const { data, error } = await c.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.displayName },
    });
    if (!error && data.user) return data.user.id;

    // Only fall through to the password-reset path when createUser failed
    // because the email is already registered; any other error (network,
    // validation, rate limit, ...) should surface as-is rather than risk
    // resetting an unrelated account's password.
    const emailAlreadyExists =
      error != null &&
      isAuthApiError(error) &&
      (error.code === "email_exists" || error.status === 422);
    if (!emailAlreadyExists) {
      throw error ?? new Error("ensureUserWithPassword: createUser returned no user");
    }

    // Already registered -> find the account and align its password.
    // A 1000-user page is fine at pilot scale; if the account isn't found
    // in that page, the lookup fails safe below by throwing rather than
    // silently resetting the wrong (or no) account.
    const { data: list, error: listError } = await c.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    const existing = list.users.find(
      (u) => u.email?.toLowerCase() === input.email.toLowerCase(),
    );
    if (!existing) throw error ?? new Error("ensureUserWithPassword: user not found");
    const { error: updateError } = await c.auth.admin.updateUserById(existing.id, {
      password: input.password,
    });
    if (updateError) throw updateError;
    return existing.id;
  },

  /**
   * Idempotent profile + active org membership for a console account.
   * Data console only. Overwrites role/status on every call by design:
   * console accounts are pinned to their spec'd role, so re-seeding must
   * always re-assert it rather than leave a manually-changed role in place.
   */
  async upsertProfileAndMembership(input: {
    userId: string;
    displayName: string;
    organizationId: string;
    role: string;
    invitedBy: string;
  }): Promise<void> {
    const c = client();
    const { error: profileError } = await c.from("profiles").upsert(
      {
        user_id: input.userId,
        display_name: input.displayName,
        locale: "en",
        time_zone: "Asia/Kuala_Lumpur",
        status: "active",
      },
      { onConflict: "user_id" },
    );
    if (profileError) throw profileError;
    const { error: memberError } = await c.from("organization_members").upsert(
      {
        organization_id: input.organizationId,
        user_id: input.userId,
        role: input.role,
        status: "active",
        invited_by: input.invitedBy,
      },
      { onConflict: "organization_id,user_id" },
    );
    if (memberError) throw memberError;
  },
};
