/**
 * Request middleware.
 *
 * Two jobs live here now: next-intl's locale routing, and publishing the
 * requested path to Server Components as `x-pathname`. Nothing else - auth
 * stays in the layouts and `requireUserOrRedirect`, which re-verify on every
 * render. Moving the check here would add a second place to keep in sync,
 * and Next explicitly warns against treating middleware as the security
 * boundary.
 *
 * Why the header has to exist: a Server Component cannot see its own URL.
 * Without this header the org layouts could only pass a static fallback to
 * `requireUserOrRedirect()`, so a session that expired on
 * `/en/acme/orders/123` sent the user to `/en/login?next=/acme` and dropped
 * them on the org landing page after they signed back in.
 *
 * Why the two jobs are composed here rather than in separate middlewares:
 * Next only runs one middleware per request. next-intl's middleware (with
 * `localePrefix: 'always'`, see `src/i18n/routing.ts`) only ever redirects a
 * bare URL to its prefixed form or passes the request through unchanged - it
 * never rewrites. A redirect is returned untouched. A pass-through is
 * rebuilt via `NextResponse.next({request})` so the `x-pathname` header can
 * be attached, with next-intl's cookies and headers (e.g. its `Link`
 * alternate-locale header) copied across by `copyResponseMetadata` in
 * `src/lib/i18n/middleware-compose.ts`.
 *
 * NOTE ON THE FILENAME: Next 16 renames this convention to `proxy.ts` and
 * logs a deprecation warning for `middleware.ts`. Do not rename it yet - on
 * 16.2.9 the Turbopack dev server does not pick up `src/proxy.ts` (it
 * compiles but never registers, so the file silently never runs, while
 * `next build` does detect it). Revisit when dev honours the new name.
 */

import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/auth/next-path";
import { routing } from "@/i18n/routing";
import {
  copyResponseMetadata,
  isRedirectResponse,
} from "@/lib/i18n/middleware-compose";

const handleI18nRouting = createMiddleware(routing);

export function middleware(request: NextRequest) {
  // next-intl runs first: it decides whether this URL needs a locale prefix.
  const i18nResponse = handleI18nRouting(request);

  // A redirect ends the request. Returning it untouched matters - attaching a
  // request header to a 307 does nothing, and rebuilding it would drop the
  // Location.
  if (isRedirectResponse(i18nResponse)) {
    return i18nResponse;
  }

  // Pass-through: rebuild so we can attach the request header. Search is
  // included so "/en/acme/orders?status=open" comes back with its filter
  // intact. The hash is browser-only and never reaches the server.
  const headers = new Headers(request.headers);
  headers.set(
    PATHNAME_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return copyResponseMetadata(
    i18nResponse,
    NextResponse.next({ request: { headers } }),
  );
}

export const config = {
  matcher: [
    // Everything except Next internals, the API, and static assets.
    //
    // The auth routes (/login, /signup, /mfa, /auth) are NO LONGER excluded:
    // they live under `[locale]` now and need the prefix like any other page.
    //
    // The whole of `_next` stays excluded: `_next/webpack-hmr` is a websocket
    // upgrade, and running it through `NextResponse.next()` breaks HMR in dev.
    "/((?!_next/|api/|favicon.ico|.*\\.[^/]+$).*)",
  ],
};
