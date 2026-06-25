import type {
  AccessReview,
  AuditLogEntry,
  Invitation,
  OrganizationMember,
  SupportSession,
} from "@/features/identity-access/types";

const EXPIRING_WINDOW_MS = 72 * 60 * 60 * 1000;

export type OperationsPriorityItem = {
  id: string;
  title: string;
  detail: string;
  category: "operations" | "access" | "support" | "audit";
  severity: "critical" | "high" | "medium" | "low";
  status: string;
  href?: string;
  timestamp?: string;
};

export type OperationsSnapshot = {
  readinessScore: number;
  alerts: {
    open: number;
    critical: number;
    acknowledged: number;
  };
  trend: Array<{
    label: string;
    livability: number;
    feedIndex: number;
    environment: number;
  }>;
  flockHighlights: Array<{
    label: string;
    value: string;
    helper: string;
    tone: "success" | "warning" | "danger" | "neutral";
  }>;
  priorityItems: OperationsPriorityItem[];
};

export type OverviewDashboardSummary = {
  identity: {
    activeMembers: number;
    suspendedMembers: number;
    pendingInvitations: number;
    expiringInvitations: number;
    openAccessReviews: number;
    activeSupportSessions: number;
    recentAuditEvents: number;
  };
  operations: OperationsSnapshot;
  priorityItems: OperationsPriorityItem[];
};

export type OverviewDashboardRows = {
  members: OrganizationMember[];
  invitations: Invitation[];
  accessReviews: AccessReview[];
  supportSessions: SupportSession[];
  auditLog: AuditLogEntry[];
};

export const operationsSnapshot: OperationsSnapshot = {
  readinessScore: 86,
  alerts: {
    open: 4,
    critical: 1,
    acknowledged: 3,
  },
  trend: [
    { label: "Mon", livability: 97, feedIndex: 82, environment: 91 },
    { label: "Tue", livability: 97.4, feedIndex: 84, environment: 93 },
    { label: "Wed", livability: 97.1, feedIndex: 86, environment: 89 },
    { label: "Thu", livability: 97.8, feedIndex: 88, environment: 92 },
    { label: "Fri", livability: 98, feedIndex: 87, environment: 94 },
    { label: "Sat", livability: 97.7, feedIndex: 90, environment: 92 },
    { label: "Sun", livability: 98.2, feedIndex: 91, environment: 95 },
  ],
  flockHighlights: [
    {
      label: "Livability",
      value: "98.2%",
      helper: "+0.4% vs last week",
      tone: "success",
    },
    {
      label: "Feed reserve",
      value: "6.8 days",
      helper: "Pontian site average",
      tone: "neutral",
    },
    {
      label: "Environment",
      value: "95%",
      helper: "Time in target band",
      tone: "success",
    },
    {
      label: "Collection pace",
      value: "92%",
      helper: "Morning round complete",
      tone: "warning",
    },
  ],
  priorityItems: [
    {
      id: "operations-biosecurity-gate",
      title: "Biosecurity gate check",
      detail: "Visitor log sync is delayed for House B2.",
      category: "operations",
      severity: "high",
      status: "Open",
      href: "/alerts",
      timestamp: "12 min ago",
    },
    {
      id: "operations-feed-bin",
      title: "Feed bin reorder review",
      detail: "Reserve is under the 7-day planning threshold.",
      category: "operations",
      severity: "medium",
      status: "Review",
      href: "/alerts",
      timestamp: "Today",
    },
  ],
};

export function buildOverviewDashboardSummary(
  rows: OverviewDashboardRows,
  now = new Date(),
): OverviewDashboardSummary {
  const activeMembers = rows.members.filter((member) => member.status === "active").length;
  const suspendedMembers = rows.members.filter((member) => member.status === "suspended").length;
  const pendingInvitations = rows.invitations.filter((invite) =>
    isPendingInvitation(invite, now),
  ).length;
  const expiringInvitations = rows.invitations.filter((invite) =>
    isExpiringInvitation(invite, now),
  ).length;
  const openAccessReviews = rows.accessReviews.filter((review) =>
    review.status === "open" || review.status === "in_progress",
  ).length;
  const activeSupportSessions = rows.supportSessions.filter(
    (session) => session.status === "active",
  ).length;

  return {
    identity: {
      activeMembers,
      suspendedMembers,
      pendingInvitations,
      expiringInvitations,
      openAccessReviews,
      activeSupportSessions,
      recentAuditEvents: rows.auditLog.length,
    },
    operations: operationsSnapshot,
    priorityItems: [
      ...buildAccessReviewPriorities(rows.accessReviews),
      ...buildSupportPriorities(rows.supportSessions),
      ...buildInvitationPriorities(rows.invitations, now),
      ...buildAuditPriorities(rows.auditLog),
      ...operationsSnapshot.priorityItems,
    ],
  };
}

function isPendingInvitation(invite: Invitation, now: Date): boolean {
  return !invite.acceptedAt && !invite.revokedAt && timestamp(invite.expiresAt) > now.getTime();
}

function isExpiringInvitation(invite: Invitation, now: Date): boolean {
  const expiresAt = timestamp(invite.expiresAt);
  return (
    isPendingInvitation(invite, now) &&
    expiresAt - now.getTime() <= EXPIRING_WINDOW_MS
  );
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildAccessReviewPriorities(
  reviews: AccessReview[],
): OperationsPriorityItem[] {
  return reviews
    .filter((review) => review.status === "open" || review.status === "in_progress")
    .sort((a, b) => timestamp(a.dueAt) - timestamp(b.dueAt))
    .slice(0, 3)
    .map((review) => ({
      id: `access-review-${review.id}`,
      title: "Access review due",
      detail: `Review period ${review.periodStart} to ${review.periodEnd}.`,
      category: "access",
      severity: review.status === "open" ? "high" : "medium",
      status: review.status === "open" ? "Open" : "In progress",
      href: "/settings/access-reviews",
      timestamp: review.dueAt,
    }));
}

function buildSupportPriorities(
  sessions: SupportSession[],
): OperationsPriorityItem[] {
  return sessions
    .filter((session) => session.status === "active")
    .slice(0, 2)
    .map((session) => ({
      id: `support-${session.id}`,
      title: "Support session active",
      detail: session.purpose,
      category: "support",
      severity: "critical",
      status: "Active",
      href: "/settings/support-sessions",
      timestamp: session.endsAt,
    }));
}

function buildInvitationPriorities(
  invitations: Invitation[],
  now: Date,
): OperationsPriorityItem[] {
  return invitations
    .filter((invite) => isExpiringInvitation(invite, now))
    .slice(0, 2)
    .map((invite) => ({
      id: `invitation-${invite.id}`,
      title: "Invitation expires soon",
      detail: `${invite.email} has not accepted the ${invite.role} invitation.`,
      category: "access",
      severity: "medium",
      status: "Pending",
      href: "/settings/users",
      timestamp: invite.expiresAt,
    }));
}

function buildAuditPriorities(auditLog: AuditLogEntry[]): OperationsPriorityItem[] {
  return auditLog.slice(0, 3).map((entry) => ({
    id: `audit-${entry.id}`,
    title: entry.eventType.replaceAll("_", " "),
    detail: entry.reason ?? `${entry.entityType} updated from ${entry.source}.`,
    category: "audit",
    severity: "low",
    status: entry.actorRole ?? "System",
    href: "/settings/audit-log",
    timestamp: entry.occurredAt,
  }));
}
