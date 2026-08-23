/**
 * The single source of truth for which languages the app supports.
 *
 * Deliberately free of `next-intl` and `next` imports: middleware, server
 * actions, client components, and plain Vitest specs all need this list, and
 * a framework import here would drag `next/server` into the test runner.
 */

export const SUPPORTED_LOCALES = ["en", "ms"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Full names, for the settings row where there is space to spell it out. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  ms: "Bahasa Melayu",
};

/** Two-letter names, for the compact header control. */
export const LOCALE_SHORT_LABELS: Record<AppLocale, string> = {
  en: "EN",
  ms: "BM",
};

export function isSupportedLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}
