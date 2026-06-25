/**
 * Render the "MFA enrolled" confirmation email.
 */

import "server-only";

import { getMessages, interpolate } from "./messages";

export function renderMfaEnrolled(input: { locale?: string }): { subject: string; html: string } {
  const messages = getMessages(input.locale ?? "en");
  return {
    subject: messages.mfaEnrolled.subject,
    html: messages.mfaEnrolled.bodyHtml,
  };
}
