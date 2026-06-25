import { NextResponse, type NextRequest } from "next/server";
import { consume } from "@/lib/rate-limit";
import { verifyMfaChallengeAction } from "@/features/identity-access/server/auth-actions";
import { MfaChallengeInput } from "@/features/identity-access/schema";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = consume(`mfa-challenge:${ip}`, 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = MfaChallengeInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await verifyMfaChallengeAction(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.code, message: result.message }, { status: 401 });
  return NextResponse.json({ ok: true });
}
