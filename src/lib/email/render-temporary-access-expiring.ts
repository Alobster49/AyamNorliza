/**
 * Render the "temporary access expiring soon" email. Sent 48h and 24h
 * before expiry by the scheduled Edge Function.
 */

import "server-only";

import { getMessages, interpolate } from "./messages";

export function renderTemporaryAccessExpiring(input: {
  organizationName: string;
  expiresAt: Date;
  locale?: string;
}): { subject: string; html: string } {
  const messages = getMessages(input.locale ?? "en");
  const values: Record<string, string> = {
    organizationName: input.organizationName,
    expiresAt: input.expiresAt.toUTCString(),
  };
  return {
    subject: messages.temporaryAccessExpiring.subject,
    html: interpolate(messages.temporaryAccessExpiring.bodyHtml, values),
  };
}
