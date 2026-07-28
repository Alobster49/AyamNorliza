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
import { listOrganizationsForCurrentUser } from "./queries";

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
): Promise<ActionResult<{ requiresMfa: boolean; redirectTo: string }>> {
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
  // dashboard. We never want login to bounce the user through "/", because
  // "/" has a fallback that redirects to /signup when no memberships are
  // visible (which made existing users land on "Create account" instead).
  const orgs = await listOrganizationsForCurrentUser();
  const redirectTo = orgs.length > 0 ? `/${orgs[0]!.slug}/settings/organization` : "/signup";

  return ok({ requiresMfa, redirectTo });
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
