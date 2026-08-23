import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Import `Link`, `redirect`, `usePathname`, and `useRouter` from HERE, never
 * from `next/link` or `next/navigation`, in any component under
 * `src/app/[locale]`.
 *
 * The plain Next versions take literal paths like `/acme/orders`. With
 * `localePrefix: 'always'` that URL does not exist — the middleware answers it
 * with a 307 to `/en/acme/orders`. The page still loads, so this fails
 * quietly: the user gets an extra round trip, a full document load instead of
 * a client transition, and their chosen locale silently resets to whatever the
 * cookie says.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
