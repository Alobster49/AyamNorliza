/**
 * Render the "MFA enrolled" confirmation email in the recipient's locale.
 */

import "server-only";

import type { AppLocale } from "@/lib/i18n/locales";
import { getEmailTranslator } from "./messages";

export function renderMfaEnrolled(input: { locale?: AppLocale }): { subject: string; html: string } {
  const t = getEmailTranslator(input.locale);
  return {
    subject: t("mfaEnrolled.subject"),
    html: t.markup("mfaEnrolled.bodyHtml", {
      p: (chunks) => `<p>${chunks}</p>`,
    }),
  };
}
