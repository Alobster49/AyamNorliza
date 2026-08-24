/**
 * Render an invitation email in the recipient's locale.
 */

import "server-only";

import type { AppLocale } from "@/lib/i18n/locales";
import { getEmailTranslator } from "./messages";

export function renderInvite(input: {
  organizationName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
  locale?: AppLocale;
}): { subject: string; html: string } {
  const t = getEmailTranslator(input.locale);
  const values = {
    organizationName: input.organizationName,
    inviterName: input.inviterName,
    role: input.role,
    expiresAt: input.expiresAt.toUTCString(),
  };
  return {
    subject: t("invite.subject", values),
    // ICU tag syntax doesn't support attributes, so `acceptUrl` is bound
    // to the `a` tag here rather than interpolated inside the message.
    html: t.markup("invite.bodyHtml", {
      ...values,
      p: (chunks) => `<p>${chunks}</p>`,
      strong: (chunks) => `<strong>${chunks}</strong>`,
      a: (chunks) => `<a href="${input.acceptUrl}">${chunks}</a>`,
    }),
  };
}
