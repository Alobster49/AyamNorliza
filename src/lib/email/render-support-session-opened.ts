/**
 * Render the "support session opened" email sent to the technician.
 */

import "server-only";

import { getMessages, interpolate } from "./messages";

export function renderSupportSessionOpened(input: {
  organizationName: string;
  purpose: string;
  startsAt: Date;
  endsAt: Date;
  locale?: string;
}): { subject: string; html: string } {
  const messages = getMessages(input.locale ?? "en");
  const values: Record<string, string> = {
    organizationName: input.organizationName,
    purpose: input.purpose,
    startsAt: input.startsAt.toUTCString(),
    endsAt: input.endsAt.toUTCString(),
  };
  return {
    subject: interpolate(messages.supportSessionOpened.subject, values),
    html: interpolate(messages.supportSessionOpened.bodyHtml, values),
  };
}
