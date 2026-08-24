/**
 * Recipient resolution for break-glass notification emails.
 *
 * `openBreakGlassAction` notifies every active owner by email. Owner rows
 * only carry `user_id` (a UUID) — the caller must resolve each owner's
 * auth email (service-role lookup) before handing the list to Resend.
 * This module keeps that grouping logic pure so it can be unit-tested:
 * recipients handed back are always email addresses, never UUIDs, and
 * owners whose email cannot be resolved are dropped rather than sent as
 * a UUID "address" that Resend would reject.
 */

import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from "@/lib/i18n/locales";

export type OwnerContact = {
  userId: string;
  /** Resolved auth email; null when the lookup failed or the user has none. */
  email: string | null;
  /** `profiles.locale` value, if the owner has a profile row. */
  locale: string | null | undefined;
};

/**
 * Group owner email addresses by their preferred locale so each owner
 * receives the break-glass email in their own language. Owners without a
 * resolvable email are skipped entirely — never fall back to the UUID.
 */
export function groupOwnerEmailsByLocale(owners: OwnerContact[]): Map<AppLocale, string[]> {
  const groups = new Map<AppLocale, string[]>();
  for (const owner of owners) {
    if (!owner.email) continue;
    const locale = isSupportedLocale(owner.locale) ? owner.locale : DEFAULT_LOCALE;
    groups.set(locale, [...(groups.get(locale) ?? []), owner.email]);
  }
  return groups;
}
