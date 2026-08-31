// supabase/functions/_shared/messages.ts
// Copy shared between Edge Functions and the app Server Actions. The
// `src/lib/email/messages.ts` is the canonical source; this file is a
// minimal copy so the Deno runtime doesn't need a build step.

export type IdentityMessages = {
  invite: { subject: string; bodyHtml: string };
  inviteResent: { subject: string; bodyHtml: string };
  mfaEnrolled: { subject: string; bodyHtml: string };
  breakGlassUsed: { subject: string; bodyHtml: string };
  temporaryAccessExpiring: { subject: string; bodyHtml: string };
  accessReviewDue: { subject: string; bodyHtml: string };
  supportSessionOpened: { subject: string; bodyHtml: string };
};

const en: IdentityMessages = {
  invite: {
    subject: "You are invited to {organizationName}",
    bodyHtml: "<p>{inviterName} invited you to join <strong>{organizationName}</strong> as <strong>{role}</strong>.</p><p>Expires {expiresAt}.</p><p><a href=\"{acceptUrl}\">Accept invitation</a></p>",
  },
  inviteResent: {
    subject: "Reminder: your invitation to {organizationName}",
    bodyHtml: "<p>{inviterName} resent the invitation.</p><p>Expires {expiresAt}.</p><p><a href=\"{acceptUrl}\">Accept invitation</a></p>",
  },
  accessReviewDue: {
    subject: "[{organizationName}] Access review due {dueAt}",
    bodyHtml: "<p>Hello,</p><p>Access review <code>{reviewId}</code> in <strong>{organizationName}</strong> is due by {dueAt}.</p><p><a href=\"{reviewUrl}\">Open review</a></p>",
  },
  mfaEnrolled: {
    subject: "Two-factor authentication enabled",
    bodyHtml: "<p>Two-factor authentication was enabled on your AyamNorliza account.</p>",
  },
  breakGlassUsed: {
    subject: "[{organizationName}] Break-glass access used",
    bodyHtml: "<p><strong>{userEmail}</strong> used break-glass access in <strong>{organizationName}</strong>.</p><p><strong>Reason:</strong> {reason}</p><p><strong>Expires:</strong> {expiresAt}</p>",
  },
  temporaryAccessExpiring: {
    subject: "Temporary access expiring soon",
    bodyHtml: "<p>Your temporary access expires on {expiresAt}.</p>",
  },
  supportSessionOpened: {
    subject: "Support session opened in {organizationName}",
    bodyHtml: "<p>A support session has been opened. Purpose: {purpose}.</p><p>Window: {startsAt} &rarr; {endsAt}</p>",
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
