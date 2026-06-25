import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Email-link verification route (passwordless / magic link).
 * Exchanges the OTP token for a session and redirects to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") ?? "magiclink";
  const next = searchParams.get("next") ?? "/";

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`);
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "magiclink" });
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=verify_failed`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
