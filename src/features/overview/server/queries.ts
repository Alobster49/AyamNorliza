import "server-only";

import {
  listAccessReviews,
  listAuditLog,
  listInvitations,
  listMembers,
  listSupportSessions,
} from "@/features/identity-access/server/queries";
import {
  buildOverviewDashboardSummary,
  type OverviewDashboardSummary,
} from "../summary-model";

export async function getOverviewDashboardSummary(
  organizationId: string,
): Promise<OverviewDashboardSummary> {
  const [members, invitations, accessReviews, supportSessions, auditLog] =
    await Promise.all([
      listMembers(organizationId),
      listInvitations(organizationId),
      listAccessReviews(organizationId),
      listSupportSessions(organizationId),
      listAuditLog({ organizationId, limit: 5 }),
    ]);

  return buildOverviewDashboardSummary({
    members,
    invitations,
    accessReviews,
    supportSessions,
    auditLog: auditLog.rows,
  });
}
