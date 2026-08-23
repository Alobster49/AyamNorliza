/**
 * Auth Server Actions used by the login / MFA / re-auth pages.
 * Re-exports the typed handlers plus a `getMfaFactorsAction` helper that
 * the MFA enrollment page calls.
 */

"use server";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setReauthCookie, clearReauthCookie } from "@/lib/auth/reauth";
import { listFactors, startEnroll, verifyChallenge, unenroll } from "@/lib/auth/mfa";
import { ReauthInput, LoginInput, MfaChallengeInput } from "../schema";
import type { ActionResult } from "./actions";
import { admin, type AdminContext } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { resolveLandingPath } from "./landing";
import { syncLocaleCookieFromAccount } from "@/lib/i18n/actions";
import type { AppLocale } from "@/lib/i18n/locales";

type AuthErrorCode = "validation" | "unauthenticated" | "internal" | "conflict";

function err<T = never>(
  code: AuthErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}
function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export async function loginAction(
  rawInput: unknown,
): Promise<
  ActionResult<{
    requiresMfa: boolean;
    redirectTo: string;
    /** Absent only if the sync itself failed - caller should keep the URL locale. */
    locale?: AppLocale;
  }>
> {
  const parsed = LoginInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid login", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error || !data.user) {
    return err("unauthenticated", "Invalid email or password");
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const requiresMfa = (aal?.currentLevel ?? "aal1") !== "aal2";

  // Resolve the destination so the client can navigate straight to a real
  // page. We never want login to bounce the user through "/", because "/"
  // has a fallback that redirects to /signup when no memberships are
  // visible (which made existing users land on "Create account" instead).
  const redirectTo = await resolveLandingPath();

  // Cross-device locale sync: carries a language chosen on another device
  // to this one. Best-effort — a sync problem must never fail a sign-in
  // that has already succeeded (same swallow-errors posture as
  // `setLocaleAction`).
  // The URL locale (whatever the login page happened to be prefixed with)
  // and the just-synced account locale can disagree on a new device - the
  // caller needs the synced value to navigate with the right one, the same
  // way /auth/callback already does.
  let locale: AppLocale | undefined;
  try {
    locale = await syncLocaleCookieFromAccount();
  } catch (syncError) {
    console.error("loginAction: locale sync failed", syncError);
  }

  return ok({ requiresMfa, redirectTo, locale });
}

export async function signOutAction(): Promise<ActionResult<{ ok: true }>> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  await clearReauthCookie();
  return ok({ ok: true });
}

export async function reauthAction(rawInput: unknown): Promise<ActionResult<{ jti: string; expiresAt: string }>> {
  const parsed = ReauthInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid reauth input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first");

  // Validate password by re-signing-in (this is the canonical way with
  // Supabase Auth: there is no separate "verify password" endpoint).
  const { error: pwdErr } = await supabase.auth.signInWithPassword({
    email: user.email ?? "",
    password: input.password,
  });
  if (pwdErr) return err("unauthenticated", "Password did not match");

  // If the user has MFA factors, also verify a TOTP code.
  const factors = await listFactors();
  const totp = factors.totp[0];
  if (totp && !input.totpCode) {
    return err("validation", "MFA code is required");
  }
  if (totp && input.totpCode) {
    const ctx: AdminContext = { actorUserId: user.id, correlationId: randomUUID() };
    const result = await verifyChallenge(totp.id, input.totpCode, ctx);
    if (!result.success) return err("unauthenticated", "MFA code did not match");
  }

  const { jti, expiresAt } = await setReauthCookie(user.id);
  return ok({ jti, expiresAt: expiresAt.toISOString() });
}

export async function getMfaFactorsAction() {
  const data = await listFactors();
  return ok({
    totp: data.totp.map((f) => ({
      id: f.id,
      friendly_name: f.friendly_name ?? null,
      created_at: f.created_at,
    })),
  });
}

export async function startMfaEnrollAction() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first");
  const ctx: AdminContext = { actorUserId: user.id, correlationId: randomUUID() };
  const data = await startEnroll(ctx);
  return ok({
    factorId: data.id,
    qrCode: data.totp?.qr_code ?? null,
    secret: data.totp?.secret ?? null,
    uri: data.totp?.uri ?? null,
  });
}

export async function verifyMfaChallengeAction(rawInput: unknown): Promise<ActionResult<{ factorId: string }>> {
  const parsed = MfaChallengeInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first");
  const ctx: AdminContext = { actorUserId: user.id, correlationId: randomUUID() };
  const result = await verifyChallenge(input.factorId, input.code, ctx);
  if (!result.success) return err("unauthenticated", result.error);
  return ok({ factorId: input.factorId });
}

export async function unenrollMfaAction(rawInput: unknown): Promise<ActionResult<{ factorId: string }>> {
  const parsed = z.object({ factorId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("unauthenticated", "Sign in first");
  const ctx: AdminContext = { actorUserId: user.id, correlationId: randomUUID() };
  await unenroll(input.factorId, ctx);
  return ok({ factorId: input.factorId });
}

const SignupInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(200),
  displayName: z.string().min(1).max(150),
});
export async function signUpAction(rawInput: unknown): Promise<ActionResult<{ requiresEmailConfirm: boolean }>> {
  const parsed = SignupInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid signup", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const supabase = await createSupabaseServerClient();
  const env = (await import("@/lib/env")).serverEnv();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { display_name: input.displayName },
      emailRedirectTo: `${env.SITE_URL}/auth/callback`,
    },
  });
  if (error) return err("conflict", error.message);
  // Best-effort profile bootstrap. Triggered on the client after sign-in
  // if missing.
  if (data.user) {
    const ctx: AdminContext = { actorUserId: data.user.id, correlationId: randomUUID() };
    await admin.insertAuthSecurityEvent(
      {
        userId: data.user.id,
        organizationId: null,
        eventType: "login_success",
        ip: null,
        userAgent: null,
        geoCountry: null,
        metadata: { reason: "signup" },
      },
      ctx,
    );
  }
  return ok({ requiresEmailConfirm: !data.session });
}
