import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "./locales";

/** The cookie name next-intl reads by default. Changing it breaks its middleware. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Resolution order: URL, then cookie, then the signed-in user's stored
 * preference, then the default.
 *
 * The URL wins because the middleware guarantees a prefix is present on every
 * rendered request. If the cookie could override it, server and client would
 * disagree about which catalog to use and React would report a hydration
 * mismatch. Cookie and database values only decide where a bare URL is sent.
 */
export function resolveLocaleFromSources(input: {
  urlLocale?: string | null;
  cookieLocale?: string | null;
  dbLocale?: string | null;
}): AppLocale {
  for (const candidate of [input.urlLocale, input.cookieLocale, input.dbLocale]) {
    if (isSupportedLocale(candidate)) return candidate;
  }
  return DEFAULT_LOCALE;
}
