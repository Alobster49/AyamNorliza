import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeNextPath, stripLocalePrefix } from "@/lib/auth/next-path";
import { syncLocaleCookieFromAccount } from "@/lib/i18n/actions";

/**
 * PKCE callback. The Supabase auth-js client handles `code` exchange
 * and sets the session cookies. We then redirect to the `next` param
 * or to the home page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` rides in on the query string, so validate it before it becomes
  // part of a Location header.
  const next = sanitizeNextPath(searchParams.get("next")) ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Resolve (and persist to the cookie) the account's stored locale now
      // that a session exists, then send the user to their own language
      // rather than whatever prefix `next` happened to carry.
      const locale = await syncLocaleCookieFromAccount();
      const unprefixed = stripLocalePrefix(next);
      const destination =
        unprefixed === "/" ? `/${locale}` : `/${locale}${unprefixed}`;
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
}
