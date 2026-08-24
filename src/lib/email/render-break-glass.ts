/**
 * Render the break-glass-used email sent to owners and the security
 * contact, in the recipient's locale.
 */

import "server-only";

import type { AppLocale } from "@/lib/i18n/locales";
import { getEmailTranslator } from "./messages";

export function renderBreakGlassUsed(input: {
  organizationName: string;
  userEmail: string;
  reason: string;
  ticketReference: string | null;
  expiresAt: Date;
  locale?: AppLocale;
}): { subject: string; html: string } {
  const t = getEmailTranslator(input.locale);
  const values = {
    organizationName: input.organizationName,
    userEmail: input.userEmail,
    reason: input.reason,
    ticketReference: input.ticketReference ?? "",
    expiresAt: input.expiresAt.toUTCString(),
  };
  return {
    subject: t("breakGlassUsed.subject", values),
    html: t.markup("breakGlassUsed.bodyHtml", {
      ...values,
      p: (chunks) => `<p>${chunks}</p>`,
      strong: (chunks) => `<strong>${chunks}</strong>`,
    }),
  };
}
