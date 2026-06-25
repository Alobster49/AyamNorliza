/**
 * Render the break-glass-used email sent to owners and the security
 * contact. Locale-aware via the messages catalog.
 */

import "server-only";

import { getMessages, interpolate } from "./messages";

export function renderBreakGlassUsed(input: {
  organizationName: string;
  userEmail: string;
  reason: string;
  ticketReference: string | null;
  expiresAt: Date;
  locale?: string;
}): { subject: string; html: string } {
  const messages = getMessages(input.locale ?? "en");
  const values: Record<string, string> = {
    organizationName: input.organizationName,
    userEmail: input.userEmail,
    reason: input.reason,
    ticketReference: input.ticketReference ?? "",
    expiresAt: input.expiresAt.toUTCString(),
  };
  return {
    subject: interpolate(messages.breakGlassUsed.subject, values),
    html: interpolate(messages.breakGlassUsed.bodyHtml, values),
  };
}
