import { stripLocalePrefix } from "@/lib/i18n/strip-locale-prefix";

/**
 * Whether `href` is the active sidebar entry for `pathname`.
 *
 * Hardened against a locale-prefixed `pathname` (e.g. "/en/acme/orders"):
 * every sidebar model builds its `href`s unprefixed, and the contract is
 * that callers pass an unprefixed `pathname` too (from `@/i18n/navigation`'s
 * `usePathname`, not `next/navigation`'s). Stripping defensively here means
 * a caller that regresses back to the wrong `usePathname` degrades to
 * "nothing highlighted" instead of crashing or highlighting the wrong item,
 * and the three near-identical copies of this function that used to live in
 * `dashboard-shell-model.ts`, `seller-shell-model.ts`, and
 * `buyer-shell-model.ts` share one implementation instead of drifting.
 */
export function isRouteActive(pathname: string, href: string): boolean {
  const normalized = stripLocalePrefix(pathname);
  return normalized === href || normalized.startsWith(`${href}/`);
}
