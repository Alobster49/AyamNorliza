import { NextResponse, type NextRequest } from "next/server";
import { consume } from "@/lib/rate-limit";
import { reauthAction } from "@/features/identity-access/server/auth-actions";

/**
 * POST /api/auth/reauth
 *
 * Accepts { password, totpCode? } and, on success, sets the
 * `reauth_proof` cookie via `setReauthCookie`. Rate-limited per IP
 * (5 attempts/minute) to defeat brute force.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = consume(`reauth:${ip}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const result = await reauthAction(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.code, message: result.message }, { status: 401 });
  }
  return NextResponse.json({ ok: true, expiresAt: result.data.expiresAt });
}
