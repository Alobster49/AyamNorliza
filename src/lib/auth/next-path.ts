import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

/**
 * Validation for the `?next=` post-login destination.
 *
 * This value reaches `router.push()` on the login form, so it is attacker
 * controlled: anyone can hand a user a `/login?next=...` link. Only
 * same-origin absolute paths are allowed through.
 *
 * Client-safe on purpose (no `server-only`): both the middleware/guards that
 * produce the value and the login form that consumes it use this function,
 * and a single shared rule is the only way the two stay in agreement.
 */

/**
 * Request header `src/middleware.ts` uses to publish the requested path to
 * Server Components. Declared here rather than in the middleware so
 * server-side callers do not have to import it (and `next/server` with it).
 */
export const PATHNAME_HEADER = "x-pathname";

/** Paths that would bounce a freshly signed-in user straight back out. */
const AUTH_PATHS = ["/login", "/signup", "/mfa", "/auth"];

/**
 * Drops a leading `/en` or `/ms` so path comparisons can be written once
 * against unprefixed paths. Returns "/" for a bare locale root.
 *
 * The query/hash is split off before checking the first segment and
 * reattached after - without this, `stripLocalePrefix("/en?foo=1")` would
 * see the first segment as the string `"en?foo=1"`, match nothing, and
 * return the value unchanged (producing a doubled-up "/en/en?foo=1" once a
 * caller re-prefixes it).
 */
export function stripLocalePrefix(path: string): string {
  const match = /^([^?#]*)([?#].*)?$/.exec(path);
  const pathname = match?.[1] ?? path;
  const suffix = match?.[2] ?? "";

  const [, first, ...rest] = pathname.split("/");
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(first ?? "")) {
    return path;
  }
  const remainder = rest.join("/");
  const strippedPathname = remainder ? `/${remainder}` : "/";
  return `${strippedPathname}${suffix}`;
}

export function sanitizeNextPath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  // Must be a same-origin absolute path. A leading "//" or "/\" is a
  // protocol-relative URL - browsers resolve "//evil.com" against the current
  // scheme and navigate off-site, so those are rejected, not repaired.
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;

  // Control characters (including the newline/tab a browser strips before it
  // parses a URL) can smuggle a "//" past the checks above.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  const rawPath = value.split(/[?#]/)[0] ?? value;
  // Compare unprefixed: after the i18n migration the value arrives as
  // "/en/login", and a literal "/login" comparison would let it through and
  // bounce the user straight back to sign-in after signing in.
  const path = stripLocalePrefix(rawPath);
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) {
    return null;
  }

  return value;
}

/**
 * Single boundary for a `next`-style path as it *enters* the app - either
 * from the `x-pathname` request header or from a `?next=` query string.
 * Runs `sanitizeNextPath`'s security checks against the RAW value first
 * (a locale-stripped value must never skip those checks), then strips any
 * locale prefix so everything downstream carries one locale-agnostic
 * representation end to end: the stored `next=` value, the header read in
 * `returnPathFor`/`buyerReturnPath`, and the destination handed to
 * `router.push()` (whose `@/i18n/navigation` router adds its own prefix
 * unconditionally, so a prefixed value here would double up into
 * "/ms/ms/...").
 *
 * This replaces the open-coded `sanitizeNextPath(...)` +
 * `stripLocalePrefix(...)` pair that used to appear at each entry point -
 * getting the order or presence of either call wrong is exactly the bug
 * this function exists to make impossible.
 */
export function toLocaleAgnostic(value: string | null | undefined): string | null {
  const sanitized = sanitizeNextPath(value);
  if (!sanitized) return null;
  const stripped = stripLocalePrefix(sanitized);
  // Stripping the locale prefix can expose a protocol-relative form that the
  // raw value did not have, e.g. "/en//evil.com" -> "//evil.com" - the exact
  // shape sanitizeNextPath's own check exists to reject. Re-assert the
  // invariant on the output, not just the input.
  if (stripped.startsWith("//") || stripped.startsWith("/\\")) return null;
  return stripped;
}
