/**
 * Request middleware.
 *
 * Sole job: publish the requested path to Server Components as `x-pathname`.
 * Nothing else - auth stays in the layouts and `requireUserOrRedirect`, which
 * re-verify on every render. Moving the check here would add a second place
 * to keep in sync, and Next explicitly warns against treating middleware as
 * the security boundary.
 *
 * Why it has to exist: a Server Component cannot see its own URL. Without
 * this header the org layouts could only pass a static fallback to
 * `requireUserOrRedirect()`, so a session that expired on
 * `/acme/orders/123` sent the user to `/login?next=/acme` and dropped them
 * on the org landing page after they signed back in.
 *
 * NOTE ON THE FILENAME: Next 16 renames this convention to `proxy.ts` and
 * logs a deprecation warning for `middleware.ts`. Do not rename it yet - on
 * 16.2.9 the Turbopack dev server does not pick up `src/proxy.ts` (it
 * compiles but never registers, so the file silently never runs, while
 * `next build` does detect it). Revisit when dev honours the new name.
 */

import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/auth/next-path";

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Search is included: "/acme/orders?status=open" must come back with its
  // filter intact. The hash is browser-only and never reaches the server.
  headers.set(
    PATHNAME_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Everything except Next internals, static assets, and the auth routes
    // themselves (which have no destination worth remembering).
    //
    // The whole of `_next` is excluded, not just static/image: `_next/
    // webpack-hmr` is a websocket upgrade, and running it through
    // `NextResponse.next()` breaks HMR in dev.
    "/((?!_next/|api/|login|signup|mfa|auth/|favicon.ico|.*\\.[^/]+$).*)",
  ],
};
