/**
 * Identity-access domain events. The dispatcher (`lib/notifications/dispatch.ts`)
 * subscribes to these names; the SQL audit log records them under
 * `audit_log.event_type` for compliance reporting.
 *
 * Plan §6.9: the canonical list. Additional internal events are kept in
 * this file so callers have one import.
 */

export const IDENTITY_EVENTS = [
  "identity.user_invited",
  "identity.membership_activated",
  "identity.role_changed",
  "identity.scope_changed",
  "identity.user_deactivated",
  "identity.temporary_access_expiring",
  "identity.break_glass_used",
  "identity.organization_created",
  "identity.organization_settings_changed",
  "identity.access_review_started",
  "identity.access_review_decided",
  "identity.support_session_opened",
  "identity.support_session_ended",
  "identity.break_glass_review_finalized",
  "identity.session_revoked",
] as const;

export type IdentityEvent = (typeof IDENTITY_EVENTS)[number];

export function isIdentityEvent(value: string): value is IdentityEvent {
  return (IDENTITY_EVENTS as readonly string[]).includes(value);
}
