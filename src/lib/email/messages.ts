/**
 * Locale-aware translator for transactional email templates. Backed by the
 * shared `email.*` namespace in `src/messages/{locale}.json` and rendered
 * with next-intl's `createTranslator`, which works outside the request
 * scope (Server Actions, background jobs) unlike `useTranslations`.
 */

import "server-only";

import { createTranslator } from "next-intl";

import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/locales";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";

// `ms.json` has the same shape as `en.json` (enforced by the catalog parity
// test), but its string literals differ, so TS infers a structurally
// incompatible literal type for it. Cast through `typeof en` — the shape
// guarantee comes from the parity test, not from TS here.
const catalogs: Record<AppLocale, typeof en> = { en, ms: ms as typeof en };

export type EmailTranslator = ReturnType<typeof createTranslator<typeof en, "email">>;

/** Returns a translator scoped to the `email` namespace for the given
 * locale, falling back to `DEFAULT_LOCALE` for anything unrecognized. */
export function getEmailTranslator(locale: AppLocale = DEFAULT_LOCALE): EmailTranslator {
  const messages = catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
  return createTranslator({ locale, messages, namespace: "email" });
}
