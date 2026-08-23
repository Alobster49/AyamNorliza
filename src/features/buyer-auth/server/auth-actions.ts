/**
 * Buyer authentication Server Actions.
 * Handles signup, signin, and signout for the buyer portal.
 */

"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/features/identity-access/server/actions";
import { normalizeMalaysianMobile } from "../lib/phone";
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

const BuyerSignupInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(150),
  phone: z.string().min(1).max(30),
  organizationSlug: z.string().min(1).max(100),
});

export async function buyerSignUpAction(
  rawInput: unknown,
): Promise<ActionResult<{ buyerId: string }>> {
  const parsed = BuyerSignupInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid signup", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const phone = normalizeMalaysianMobile(input.phone);
  if (!phone) {
    return err("validation", "Enter a Malaysian mobile number, e.g. 012-345 6789", {
      phone: ["Enter a Malaysian mobile number, e.g. 012-345 6789"],
    });
  }

  const supabase = await createSupabaseServerClient();

  // Get organization ID from slug
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", input.organizationSlug)
    .single();

  if (orgError || !org) {
    return err("validation", "Kedai tidak dijumpai.");
  }

  // Sign up the user with Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { display_name: input.displayName },
    },
  });

  if (error) {
    // The email may already own an auth user that is not a buyer — a
    // console/staff account, or a buyer whose profile row was wiped when
    // the pilot data was reset. Signing up looks impossible ("already
    // registered") while signing in looks wrong ("not a buyer"), so the
    // person is locked out of the shop. If they can prove ownership with
    // the password they just typed, attach a buyer profile to that account.
    if (isAlreadyRegistered(error)) {
      return attachBuyerToExistingAccount({
        supabase,
        email: input.email,
        password: input.password,
        displayName: input.displayName,
        phone,
        organizationId: org.id,
      });
    }
    return err("conflict", "Tidak dapat membuat akaun. Sila cuba lagi.");
  }

  if (!data.user) {
    return err("internal", "Tidak dapat membuat akaun. Sila cuba lagi.");
  }

  // Create buyer record
  const { error: buyerError } = await supabase.from("buyers").insert({
    id: data.user.id,
    organization_id: org.id,
    display_name: input.displayName,
    phone,
  });

  if (buyerError) {
    // Rollback via the service-role client — the anon-key server client
    // cannot call auth.admin.*. Without this the email is stranded:
    // signUp says "already registered", signIn says "not a buyer".
    try {
      await admin.deleteAuthUser(data.user.id);
    } catch (rollbackError) {
      console.error("buyerSignUpAction: rollback failed", rollbackError);
    }
    // signUp set session cookies for the now-deleted user; clear them.
    await supabase.auth.signOut();
    return err("internal", "Tidak dapat menyimpan profil pembeli. Sila cuba lagi.");
  }

  return ok({ buyerId: data.user.id });
}

/** Supabase reports a duplicate email as an AuthApiError, not a field error. */
function isAlreadyRegistered(error: { message: string; code?: string }): boolean {
  if (error.code === "user_already_exists" || error.code === "email_exists") return true;
  return /already\s+(been\s+)?registered|already\s+exists/i.test(error.message);
}

/**
 * Adopt an existing auth user as a buyer of this organization.
 *
 * Only ever called after `signUp` refused the email. The password is
 * re-checked through the normal sign-in path, so this grants nothing that
 * logging in would not: a wrong password gets the same generic answer as
 * any failed login, and no auth user is ever created or deleted here.
 */
async function attachBuyerToExistingAccount(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  email: string;
  password: string;
  displayName: string;
  phone: string;
  organizationId: string;
}): Promise<ActionResult<{ buyerId: string }>> {
  const { supabase, email, password, displayName, phone, organizationId } = args;

  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signIn.user) {
    return err("conflict", "Emel ini sudah didaftarkan. Sila log masuk.");
  }

  const userId = signIn.user.id;

  const { data: existing, error: existingError } = await supabase
    .from("buyers")
    .select("id, organization_id")
    .eq("id", userId)
    .maybeSingle();

  if (existingError) {
    await supabase.auth.signOut();
    return err("internal", "Tidak dapat menyemak profil pembeli. Sila cuba lagi.");
  }

  if (existing) {
    // Already a buyer — the person just used the wrong tab. They are signed
    // in now, so treat it as a successful entry rather than an error.
    if (existing.organization_id !== organizationId) {
      await supabase.auth.signOut();
      return err("conflict", "Akaun ini bukan pembeli untuk kedai ini.");
    }
    return ok({ buyerId: userId });
  }

  const { error: insertError } = await supabase.from("buyers").insert({
    id: userId,
    organization_id: organizationId,
    display_name: displayName,
    phone,
  });

  if (insertError) {
    // The auth user existed before this call — never delete it on rollback.
    await supabase.auth.signOut();
    return err("internal", "Tidak dapat menyimpan profil pembeli. Sila cuba lagi.");
  }

  return ok({ buyerId: userId });
}

const BuyerLoginInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  organizationSlug: z.string().min(1).max(100).optional(),
});

export async function buyerSignInAction(
  rawInput: unknown,
): Promise<
  ActionResult<{
    buyerId: string;
    /** Absent only if the sync itself failed - caller should keep the URL locale. */
    locale?: AppLocale;
  }>
> {
  const parsed = BuyerLoginInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid login", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Sign in with Supabase Auth
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error || !data.user) {
    return err("unauthenticated", "Emel atau kata laluan salah.");
  }

  // Verify this is a buyer
  const { data: buyer, error: buyerError } = await supabase
    .from("buyers")
    .select("id, organization_id")
    .eq("id", data.user.id)
    .single();

  if (buyerError || !buyer) {
    await supabase.auth.signOut();
    return err("unauthenticated", "Akaun ini belum didaftarkan sebagai pembeli.");
  }

  // If organization slug was provided, verify it matches
  if (input.organizationSlug) {
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", input.organizationSlug)
      .single();

    if (!org || org.id !== buyer.organization_id) {
      await supabase.auth.signOut();
      return err("unauthenticated", "Akaun ini bukan pembeli untuk kedai ini.");
    }
  }

  // Cross-device locale sync: carries a language chosen on another device
  // to this one. Best-effort — a sync problem must never fail a sign-in
  // that has already succeeded (same swallow-errors posture as
  // `setLocaleAction`).
  let locale: AppLocale | undefined;
  try {
    locale = await syncLocaleCookieFromAccount();
  } catch (syncError) {
    console.error("buyerSignInAction: locale sync failed", syncError);
  }

  return ok({ buyerId: buyer.id, locale });
}

export async function buyerSignOutAction(): Promise<ActionResult<{ ok: true }>> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return ok({ ok: true });
}
