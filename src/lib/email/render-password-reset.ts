/**
 * Render an admin-triggered password-reset email in the recipient's locale.
 */

import "server-only";

import type { AppLocale } from "@/lib/i18n/locales";
import { getEmailTranslator } from "./messages";

export function renderPasswordReset(input: {
  organizationName: string;
  resetUrl: string;
  locale?: AppLocale;
}): { subject: string; html: string } {
  const t = getEmailTranslator(input.locale);
  const values = { organizationName: input.organizationName };
  return {
    subject: t("passwordReset.subject", values),
    // ICU tag syntax doesn't support attributes, so `resetUrl` is bound
    // to the `a` tag here rather than interpolated inside the message.
    html: t.markup("passwordReset.bodyHtml", {
      ...values,
      p: (chunks) => `<p>${chunks}</p>`,
      strong: (chunks) => `<strong>${chunks}</strong>`,
      a: (chunks) => `<a href="${input.resetUrl}">${chunks}</a>`,
    }),
  };
}
