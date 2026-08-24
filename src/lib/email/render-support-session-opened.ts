/**
 * Render the "support session opened" email sent to the technician, in
 * the recipient's locale.
 */

import "server-only";

import type { AppLocale } from "@/lib/i18n/locales";
import { getEmailTranslator } from "./messages";

export function renderSupportSessionOpened(input: {
  organizationName: string;
  purpose: string;
  startsAt: Date;
  endsAt: Date;
  locale?: AppLocale;
}): { subject: string; html: string } {
  const t = getEmailTranslator(input.locale);
  const values = {
    organizationName: input.organizationName,
    purpose: input.purpose,
    startsAt: input.startsAt.toUTCString(),
    endsAt: input.endsAt.toUTCString(),
  };
  return {
    subject: t("supportSessionOpened.subject", values),
    html: t.markup("supportSessionOpened.bodyHtml", {
      ...values,
      p: (chunks) => `<p>${chunks}</p>`,
      strong: (chunks) => `<strong>${chunks}</strong>`,
    }),
  };
}
