/**
 * Locale copy for identity-access email templates. The `en` baseline
 * is the canonical copy; additional locales are layered on top via
 * deep-merge when supplied.
 */

export type IdentityMessages = {
  invite: { subject: string; bodyHtml: string };
  inviteResent: { subject: string; bodyHtml: string };
  mfaEnrolled: { subject: string; bodyHtml: string };
  breakGlassUsed: { subject: string; bodyHtml: string };
  temporaryAccessExpiring: { subject: string; bodyHtml: string };
  supportSessionOpened: { subject: string; bodyHtml: string };
};

const en: IdentityMessages = {
  invite: {
    subject: "You are invited to {organizationName}",
    bodyHtml: `
      <p>{inviterName} invited you to join <strong>{organizationName}</strong>
      as <strong>{role}</strong>.</p>
      <p>This invitation expires {expiresAt}.</p>
      <p><a href="{acceptUrl}">Accept invitation</a></p>
    `,
  },
  inviteResent: {
    subject: "Reminder: your invitation to {organizationName}",
    bodyHtml: `
      <p>{inviterName} resent the invitation to join <strong>{organizationName}</strong>
      as <strong>{role}</strong>.</p>
      <p>This invitation expires {expiresAt}.</p>
      <p><a href="{acceptUrl}">Accept invitation</a></p>
    `,
  },
  mfaEnrolled: {
    subject: "Two-factor authentication enabled",
    bodyHtml: `<p>Two-factor authentication was enabled on your AyamNorliza account.</p>
      <p>If this was not you, contact your organization owner immediately.</p>`,
  },
  breakGlassUsed: {
    subject: "[{organizationName}] Break-glass access used",
    bodyHtml: `
      <p><strong>{userEmail}</strong> used break-glass access in
      <strong>{organizationName}</strong>.</p>
      <p><strong>Reason:</strong> {reason}</p>
      <p><strong>Ticket:</strong> {ticketReference}</p>
      <p><strong>Expires:</strong> {expiresAt}</p>
      <p>A post-use review is required after the session ends.</p>
    `,
  },
  temporaryAccessExpiring: {
    subject: "Temporary access expiring soon",
    bodyHtml: `
      <p>Your temporary access to <strong>{organizationName}</strong>
      expires on {expiresAt}.</p>
      <p>Ask your organization owner to renew it if you still need access.</p>
    `,
  },
  supportSessionOpened: {
    subject: "Support session opened in {organizationName}",
    bodyHtml: `
      <p>A support session has been opened for you in
      <strong>{organizationName}</strong>.</p>
      <p><strong>Purpose:</strong> {purpose}</p>
      <p><strong>Window:</strong> {startsAt} → {endsAt}</p>
    `,
  },
};

const catalogs: Record<string, IdentityMessages> = { en };

export function getMessages(locale: string): IdentityMessages {
  return catalogs[locale] ?? catalogs.en!;
}

export function interpolate(template: string, values: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = values[key];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}
