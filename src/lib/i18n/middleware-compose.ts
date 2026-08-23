import { NextResponse } from "next/server";

/**
 * Helpers for running two middlewares in one request.
 *
 * next-intl's middleware returns one of two things when `localePrefix` is
 * `'always'`: a redirect (bare URL to a prefixed one) or a pass-through. It
 * does not rewrite, because with an always-on prefix the incoming pathname
 * already matches the `[locale]` file route. That is what makes composing it
 * tractable — see the note in `src/i18n/routing.ts`.
 *
 * A pass-through response cannot simply be returned, because our middleware
 * also has to attach a REQUEST header, and request headers can only be set by
 * the `NextResponse.next({request})` call that creates the response. So we
 * build our own response and move next-intl's cookies and headers onto it.
 */

/** Headers that belong to the response object that created them. */
const INTERNAL_HEADERS = new Set([
  "x-middleware-next",
  "x-middleware-override-headers",
  "x-middleware-rewrite",
  "set-cookie",
]);

export function isRedirectResponse(response: Response): boolean {
  return response.headers.has("location");
}

export function copyResponseMetadata(
  from: Response,
  to: NextResponse,
): NextResponse {
  from.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (INTERNAL_HEADERS.has(name)) return;
    // Next stamps its own request-header directives on `to`; anything starting
    // with x-middleware-request- belongs to the source response's own request
    // copy and would corrupt ours.
    if (name.startsWith("x-middleware-request-")) return;
    to.headers.set(key, value);
  });

  // Cookies move through the cookie API rather than the raw Set-Cookie header,
  // so multiple cookies survive instead of collapsing into one.
  for (const cookie of (from as NextResponse).cookies?.getAll() ?? []) {
    to.cookies.set(cookie);
  }

  return to;
}
