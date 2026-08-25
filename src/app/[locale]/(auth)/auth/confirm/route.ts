import { NextResponse, type NextRequest } from "next/server";
import { getLocale } from "next-intl/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toLocaleAgnostic } from "@/lib/auth/next-path";
import { syncLocaleCookieFromAccount } from "@/lib/i18n/actions";

/**
 * OTP-hash confirmation endpoint for admin-generated links (documented
 * SSR admin-reset pattern). Unlike `/auth/callback` (PKCE `code`
 * exchange, which requires the code_verifier cookie set in the browser
 * that STARTED the flow), `verifyOtp` with a `token_hash` works in any
 * browser — exactly what an admin-triggered password reset needs, since
 * the recovery link opens in the target user's browser, not the admin's.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // `next` rides in on the query string, so validate it before it becomes
  // part of a Location header (same treatment as callback/route.ts).
  const next = toLocaleAgnostic(searchParams.get("next")) ?? "/";

  if (tokenHash && type === "recovery") {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash,
    });
    if (!error) {
      // Session cookies are now set for the TARGET user; resolve their
      // stored locale and send them on (mirrors callback/route.ts).
      const locale = await syncLocaleCookieFromAccount();
      const destination = next === "/" ? `/${locale}` : `/${locale}${next}`;
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }
  const locale = await getLocale();
  return NextResponse.redirect(`${origin}/${locale}/login?error=callback_failed`);
}
