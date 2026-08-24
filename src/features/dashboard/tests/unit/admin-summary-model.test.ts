import { describe, expect, it } from "vitest";
import { buildAdminSummary } from "../../analytics/admin-summary-model";
import type {
  AccessReview,
  AuditLogEntry,
  Invitation,
  OrganizationMember,
  SupportSession,
} from "@/features/identity-access/types";

const now = new Date("2026-06-25T00:00:00.000Z");

function member(overrides: Partial<OrganizationMember>): OrganizationMember {
  return {
    id: "member-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "caretaker",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    invitedBy: null,
    sponsorId: null,
    clientOperationId: null,
    ...overrides,
  };
}

function invitation(overrides: Partial<Invitation>): Invitation {
  return {
    id: "invite-1",
    organizationId: "org-1",
    email: "worker@example.com",
    role: "caretaker",
    proposedScopes: [],
    expiresAt: "2026-06-27T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    invitedBy: "owner-1",
    ...overrides,
  };
}

function review(overrides: Partial<AccessReview>): AccessReview {
  return {
    id: "review-1",
    organizationId: "org-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    reviewerId: "owner-1",
    status: "open",
    dueAt: "2026-06-26T00:00:00.000Z",
    ...overrides,
  };
}

function supportSession(overrides: Partial<SupportSession>): SupportSession {
  return {
    id: "support-1",
    organizationId: "org-1",
    sponsorId: "owner-1",
    technicianId: "tech-1",
    purpose: "Diagnostics",
    permittedScopes: [],
    startsAt: "2026-06-24T23:00:00.000Z",
    endsAt: "2026-06-25T02:00:00.000Z",
    recordingReference: null,
    status: "active",
    ...overrides,
  };
}

function audit(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: "audit-1",
    organizationId: "org-1",
    actorUserId: "owner-1",
    actorRole: "owner",
    eventType: "identity.role_changed",
    entityType: "organization_members",
    entityId: "member-1",
    before: null,
    after: null,
    reason: "Quarterly review",
    correlationId: "corr-1",
    source: "web",
    occurredAt: "2026-06-24T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildAdminSummary", () => {
  it("counts live identity and access metrics from existing rows", () => {
    const summary = buildAdminSummary(
      {
        members: [
          member({ id: "active-1", status: "active" }),
          member({ id: "active-2", status: "active", expiresAt: "2026-06-26T00:00:00.000Z" }),
          member({ id: "suspended-1", status: "suspended" }),
        ],
        invitations: [
          invitation({ id: "pending-1" }),
          invitation({ id: "accepted-1", acceptedAt: "2026-06-24T00:00:00.000Z" }),
          invitation({ id: "revoked-1", revokedAt: "2026-06-24T00:00:00.000Z" }),
          invitation({ id: "expired-1", expiresAt: "2026-06-20T00:00:00.000Z" }),
        ],
        accessReviews: [
          review({ id: "open-1", status: "open" }),
          review({ id: "progress-1", status: "in_progress" }),
          review({ id: "done-1", status: "completed" }),
        ],
        supportSessions: [
          supportSession({ id: "active-support", status: "active" }),
          supportSession({ id: "scheduled-support", status: "scheduled" }),
          supportSession({ id: "ended-support", status: "ended" }),
        ],
        auditLog: [
          audit({ id: "audit-1", eventType: "identity.role_changed" }),
          audit({ id: "audit-2", eventType: "identity.user_invited" }),
        ],
      },
      now,
    );

    expect(summary.identity.activeMembers).toBe(2);
    expect(summary.identity.suspendedMembers).toBe(1);
    expect(summary.identity.pendingInvitations).toBe(1);
    expect(summary.identity.expiringInvitations).toBe(1);
    expect(summary.identity.openAccessReviews).toBe(2);
    expect(summary.identity.activeSupportSessions).toBe(1);
    expect(summary.identity.recentAuditEvents).toBe(2);
    expect(summary.priorityItems.map((item) => item.id)).toContain("access-review-open-1");
    expect(summary.priorityItems.map((item) => item.id)).toContain("support-active-support");
  });

  it("returns zero live counts and no priority items for empty rows", () => {
    const summary = buildAdminSummary(
      {
        members: [],
        invitations: [],
        accessReviews: [],
        supportSessions: [],
        auditLog: [],
      },
      now,
    );

    expect(summary.identity).toEqual({
      activeMembers: 0,
      suspendedMembers: 0,
      pendingInvitations: 0,
      expiringInvitations: 0,
      openAccessReviews: 0,
      activeSupportSessions: 0,
      recentAuditEvents: 0,
    });
    expect(summary.priorityItems).toEqual([]);
  });
});
