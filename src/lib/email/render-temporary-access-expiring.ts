/**
 * Render the "temporary access expiring soon" email in the recipient's
 * locale. Sent 48h and 24h before expiry by the scheduled Edge Function.
 */

import "server-only";

import type { AppLocale } from "@/lib/i18n/locales";
import { getEmailTranslator } from "./messages";

export function renderTemporaryAccessExpiring(input: {
  organizationName: string;
  expiresAt: Date;
  locale?: AppLocale;
}): { subject: string; html: string } {
  const t = getEmailTranslator(input.locale);
  const values = {
    organizationName: input.organizationName,
    expiresAt: input.expiresAt.toUTCString(),
  };
  return {
    subject: t("temporaryAccessExpiring.subject"),
    html: t.markup("temporaryAccessExpiring.bodyHtml", {
      ...values,
      p: (chunks) => `<p>${chunks}</p>`,
      strong: (chunks) => `<strong>${chunks}</strong>`,
    }),
  };
}
