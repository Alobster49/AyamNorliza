/**
 * Render an invitation email. Uses the locale-aware message catalog
 * when a locale is supplied; falls back to the inline English copy for
 * backwards compatibility.
 */

import "server-only";

import { serverEnv } from "@/lib/env";
import { getMessages, interpolate } from "./messages";

export function renderInvite(input: {
  organizationName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
  locale?: string;
}): { subject: string; html: string } {
  const env = serverEnv();
  const locale = input.locale ?? env.EMAIL_FROM.includes("malay") ? "en" : "en";
  const messages = getMessages(locale);
  const values: Record<string, string> = {
    organizationName: input.organizationName,
    inviterName: input.inviterName,
    role: input.role,
    acceptUrl: input.acceptUrl,
    expiresAt: input.expiresAt.toUTCString(),
  };
  return {
    subject: interpolate(messages.invite.subject, values),
    html: interpolate(messages.invite.bodyHtml, values),
  };
}
