"use server";

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, resolveLocaleFromSources } from "./cookie";
import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "./locales";

export type SetLocaleResult =
  | { ok: true }
  | { ok: false; messageKey: string };

/**
 * Records the user's language choice.
 *
 * The cookie is the part that always happens — it is what makes the choice
 * survive for signed-out visitors and what next-intl reads when it has to pick
 * a target for a bare-URL redirect. The database write is best-effort on top:
 * it is what carries the choice to a second device and to email.
 *
 * Returns a message key rather than prose so the caller can translate it.
 */
export async function setLocaleAction(locale: string): Promise<SetLocaleResult> {
  if (!isSupportedLocale(locale)) {
    return { ok: false, messageKey: "auth.errors.unexpected" };
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out is the normal case on the login page. The cookie already did
  // the job, so this is a success, not a failure.
  if (!user) return { ok: true };

  // A person is a buyer or a staff member, never both, but writing both and
  // letting RLS drop the one that does not apply avoids a round trip to find
  // out which. Errors are swallowed on purpose: a failed preference write must
  // not block the language from changing.
  await supabase.from("profiles").update({ locale }).eq("user_id", user.id);
  await supabase.from("buyers").update({ locale }).eq("id", user.id);

  return { ok: true };
}

/**
 * Reads the signed-in user's stored locale and writes it to the cookie.
 *
 * Called once at the auth callback, not on every navigation: the cookie is
 * what next-intl consults when it has to choose a prefix, so setting it at the
 * moment a session appears is enough for every later request.
 *
 * The cookie wins over the database when both exist, so a language picked
 * while signed out is not overwritten by a stale stored value.
 */
export async function syncLocaleCookieFromAccount(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return resolveLocaleFromSources({ cookieLocale });

  const [{ data: profile }, { data: buyer }] = await Promise.all([
    supabase.from("profiles").select("locale").eq("user_id", user.id).maybeSingle(),
    supabase.from("buyers").select("locale").eq("id", user.id).maybeSingle(),
  ]);

  const resolved = resolveLocaleFromSources({
    cookieLocale,
    dbLocale: profile?.locale ?? buyer?.locale ?? null,
  });

  if (resolved !== cookieLocale) {
    cookieStore.set(LOCALE_COOKIE_NAME, resolved, {
      maxAge: LOCALE_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
  }

  return resolved ?? DEFAULT_LOCALE;
}
