/**
 * TOTP / MFA helpers. Phase 1 ships TOTP only; WebAuthn / passkeys are
 * deferred to a later phase (see plan §13 open decisions).
 *
 * The Supabase Auth `enroll` and `challenge` endpoints are called via the
 * server client so the MFA factor is stored against `auth.users` and the
 * `mfa_*_factors` views; the `auth_security_events` table records enroll
 * and challenge outcomes for audit.
 *
 * MFA is optional by default — users can skip enrollment and proceed with
 * aal1. Organizations may optionally enforce MFA via their settings.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin, type AdminContext } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export async function startEnroll(ctx: AdminContext) {
  const supabase = await createSupabaseServerClient();
  const env = serverEnv();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: env.TOTP_ISSUER,
    friendlyName: env.TOTP_ISSUER,
  });
  if (error) throw error;
  await admin.insertAuthSecurityEvent(
    {
      userId: ctx.actorUserId,
      organizationId: null,
      eventType: "mfa_enroll",
      ip: null,
      userAgent: null,
      geoCountry: null,
      metadata: { factor_id: data.id },
    },
    ctx,
  );
  return data;
}

export async function verifyChallenge(
  factorId: string,
  code: string,
  ctx: AdminContext,
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    await admin.insertAuthSecurityEvent(
      {
        userId: ctx.actorUserId,
        organizationId: null,
        eventType: "mfa_challenge_failure",
        ip: null,
        userAgent: null,
        geoCountry: null,
        metadata: { factor_id: factorId, message: error.message },
      },
      ctx,
    );
    return { success: false, error: error.message };
  }
  await admin.insertAuthSecurityEvent(
    {
      userId: ctx.actorUserId,
      organizationId: null,
      eventType: "mfa_challenge_success",
      ip: null,
      userAgent: null,
      geoCountry: null,
      metadata: { factor_id: factorId },
    },
    ctx,
  );
  return { success: true };
}

export async function listFactors() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data;
}

/**
 * Remove (unenroll) a TOTP factor. Used when a user chooses to disable MFA
 * or to remove an existing factor before re-enrolling.
 */
export async function unenroll(factorId: string, ctx: AdminContext) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  await admin.insertAuthSecurityEvent(
    {
      userId: ctx.actorUserId,
      organizationId: null,
      eventType: "mfa_unenroll",
      ip: null,
      userAgent: null,
      geoCountry: null,
      metadata: { factor_id: factorId },
    },
    ctx,
  );
}
