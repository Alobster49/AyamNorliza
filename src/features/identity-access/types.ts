/**
 * Domain types for the identity-access feature module.
 * Hand-written mirror of the generated `Database` types so Server Actions
 * and UI components can import named types without circular dependencies.
 */

export type Organization = {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  region: string | null;
  defaultTimeZone: string;
  defaultLocale: string;
  status: "active" | "suspended" | "archived";
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Profile = {
  userId: string;
  displayName: string;
  locale: string;
  timeZone: string;
  contactPreferences: Record<string, unknown>;
  status: "active" | "inactive";
  avatar: string | null;
};

export type OrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  status: "invited" | "active" | "suspended" | "expired";
  startsAt: string;
  expiresAt: string | null;
  invitedBy: string | null;
  sponsorId: string | null;
  clientOperationId: string | null;
};

export type MemberScope = {
  id: string;
  organizationMemberId: string;
  organizationId: string;
  siteId: string | null;
  zoneId: string | null;
  houseId: string | null;
  permission: string | null;
  startsAt: string;
  expiresAt: string | null;
};

export type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  proposedScopes: Array<{
    siteId?: string | null;
    zoneId?: string | null;
    houseId?: string | null;
    permission?: string | null;
    expiresAt?: string | null;
  }>;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedBy: string;
};

export type AccessReview = {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  reviewerId: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  dueAt: string;
};

export type AccessReviewItem = {
  id: string;
  accessReviewId: string;
  organizationMemberId: string;
  decision: "keep" | "modify" | "revoke" | "pending";
  decisionReason: string | null;
  evidence: Record<string, unknown>;
  decidedAt: string | null;
  decidedBy: string | null;
};

export type BreakGlassEvent = {
  id: string;
  organizationId: string;
  userId: string;
  reason: string;
  ticketReference: string | null;
  approvedBy: string | null;
  startsAt: string;
  expiresAt: string;
  endedAt: string | null;
  postUseReview: Record<string, unknown>;
};

export type AuthSecurityEventType =
  | "login_success"
  | "login_failure"
  | "mfa_enroll"
  | "mfa_unenroll"
  | "mfa_challenge_success"
  | "mfa_challenge_failure"
  | "password_reset"
  | "token_refresh"
  | "session_revoke"
  | "suspicious_activity";

export type AuditLogEntry = {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  correlationId: string | null;
  source: "web" | "mobile" | "device" | "integration" | "job" | "import" | "server";
  occurredAt: string;
};
