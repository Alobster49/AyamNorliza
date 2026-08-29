/**
 * Multi-channel notification dispatcher.
 *
 * Channels: `email` (Resend), `inapp` (Realtime, added in a later phase).
 * Sensitive events route here from Server Actions; the dispatcher writes
 * a row to `notifications` (added in MOD-06) and resolves delivery status.
 *
 * Phase 1 ships the dispatcher shell and a typed event registry. The
 * actual `inapp` channel requires the `notifications` table from MOD-06
 * and is wired in Phase 2.
 */

import "server-only";

import { sendEmail } from "@/lib/email/resend";

export type NotificationEvent =
  | "identity.user_invited"
  | "identity.membership_activated"
  | "identity.role_changed"
  | "identity.scope_changed"
  | "identity.user_deactivated"
  | "identity.user_removed"
  | "identity.temporary_access_expiring"
  | "identity.break_glass_used"
  | "identity.organization_created"
  | "identity.organization_settings_changed"
  | "identity.access_review_started"
  | "identity.access_review_decided"
  | "identity.break_glass_review_finalized"
  | "identity.session_revoked";

export type NotificationPayload = {
  event: NotificationEvent;
  organizationId: string;
  recipients: string[];
  data: Record<string, unknown>;
  // SLA: high-priority events must be delivered within 60 seconds.
  priority?: "high" | "normal";
};

const HIGH_PRIORITY: ReadonlySet<NotificationEvent> = new Set([
  "identity.break_glass_used",
  "identity.user_deactivated",
  "identity.user_removed",
  "identity.temporary_access_expiring",
]);

export async function dispatch(payload: NotificationPayload): Promise<void> {
  if (HIGH_PRIORITY.has(payload.event)) payload.priority ??= "high";
  // Notifications are a best-effort side-effect: callers dispatch *after* the
  // state change and its audit event are already committed, so a mail-provider
  // outage must not turn a completed action (deactivation, role change) into a
  // rejected Server Action. Log and carry on instead of throwing.
  try {
    await sendEmail({
      to: payload.recipients,
      subject: subjectFor(payload),
      html: renderHtml(payload),
    });
  } catch (e) {
    console.error(
      `notifications: failed to deliver "${payload.event}" to ${payload.recipients.length} recipient(s)`,
      e,
    );
  }
}

function subjectFor(p: NotificationPayload): string {
  switch (p.event) {
    case "identity.user_invited":
      return "You have been invited to AyamNorliza";
    case "identity.role_changed":
      return "Your role has changed";
    case "identity.scope_changed":
      return "Your access scope has changed";
    case "identity.user_deactivated":
      return "Account deactivated";
    case "identity.user_removed":
      return "Removed from organization";
    case "identity.break_glass_used":
      return "Break-glass access used";
    case "identity.temporary_access_expiring":
      return "Temporary access expiring soon";
    default:
      return `AyamNorliza: ${p.event}`;
  }
}

function renderHtml(p: NotificationPayload): string {
  // Phase 1: minimal HTML, locale-aware copy in a later phase.
  const data = JSON.stringify(p.data, null, 2);
  return `<p>${subjectFor(p)}</p><pre>${escape(data)}</pre>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
