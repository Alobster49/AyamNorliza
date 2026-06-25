import { NextResponse, type NextRequest } from "next/server";
import { consume } from "@/lib/rate-limit";
import { startMfaEnrollAction } from "@/features/identity-access/server/auth-actions";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = consume(`mfa-enroll:${ip}`, 5, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const result = await startMfaEnrollAction();
  if (!result.ok) return NextResponse.json({ error: result.code, message: result.message }, { status: 400 });
  return NextResponse.json(result.data);
}
