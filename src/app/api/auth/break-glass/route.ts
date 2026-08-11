import { NextResponse, type NextRequest } from "next/server";
import { consume } from "@/lib/rate-limit";
import { OpenBreakGlassInput } from "@/features/identity-access/schema";
import { openBreakGlassAction } from "@/features/identity-access/server/actions";
import { UnauthenticatedError } from "@/lib/auth/require-user";

/**
 * POST /api/auth/break-glass
 * Open a break-glass event directly from a client-side caller. The
 * action requires a valid reauth cookie (server-enforced), so this
 * endpoint is mostly useful for cron jobs or external integrations.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = consume(`break-glass:${ip}`, 3, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = OpenBreakGlassInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", details: parsed.error.flatten() }, { status: 400 });
  }
  let result: Awaited<ReturnType<typeof openBreakGlassAction>>;
  try {
    result = await openBreakGlassAction(parsed.data);
  } catch (e) {
    // A caller without a session reaches the action's reauth check, which
    // rethrows UnauthenticatedError. Map it to 401 here rather than letting
    // it surface as an unhandled 500.
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw e;
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, message: result.message },
      { status: result.code === "reauth_required" ? 401 : 400 },
    );
  }
  return NextResponse.json(result.data);
}
