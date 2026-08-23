import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/i18n/locales";

/**
 * `localePrefix: 'always'` means every URL carries `/en` or `/ms`. The
 * alternative ('as-needed') hides the default locale's prefix, which forces
 * next-intl to rewrite requests — and a rewrite would collide with the
 * `x-pathname` header that `src/middleware.ts` publishes. Always-prefix keeps
 * the middleware to a redirect-or-passthrough, which is far easier to compose.
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});
