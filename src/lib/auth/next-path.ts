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

  const path = value.split(/[?#]/)[0] ?? value;
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) {
    return null;
  }

  return value;
}
