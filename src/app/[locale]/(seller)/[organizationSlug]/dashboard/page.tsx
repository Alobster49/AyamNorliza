import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { getDashboardSales, getDashboardToday } from "@/features/dashboard/server/analytics-actions";
import { bucketForRange, resolveRange } from "@/features/dashboard/analytics/date-range";
import { AnalyticsDashboard } from "@/features/dashboard/analytics/components/analytics-dashboard";
import {
  listAccessReviews,
  listAuditLog,
  listInvitations,
  listMembers,
  listSupportSessions,
} from "@/features/identity-access/server/queries";
import {
  buildAdminSummary,
  type AdminSummary,
} from "@/features/dashboard/analytics/admin-summary-model";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let orgId: string;
  let role: string;
  let timeZone: string;
  try {
    ({ orgId, role, timeZone } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${await getLocale()}/${organizationSlug}`);
    }
    throw error;
  }

  const initialRange = resolveRange("30d", timeZone);
  const isAdmin = role === "owner" || role === "org_admin";
  const [sales, today, adminSummary] = await Promise.all([
    getDashboardSales(
      organizationSlug,
      initialRange.from,
      initialRange.to,
      bucketForRange(initialRange.from, initialRange.to),
    ),
    getDashboardToday(organizationSlug),
    isAdmin
      ? Promise.all([
          listMembers(orgId),
          listInvitations(orgId),
          listAccessReviews(orgId),
          listSupportSessions(orgId),
          listAuditLog({ organizationId: orgId, limit: 5 }),
        ])
          .then(([members, invitations, accessReviews, supportSessions, audit]): AdminSummary =>
            buildAdminSummary({
              members,
              invitations,
              accessReviews,
              supportSessions,
              auditLog: audit.rows,
            }),
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <AnalyticsDashboard
      organizationSlug={organizationSlug}
      timeZone={timeZone}
      initialRange={initialRange}
      initialSales={sales.ok ? sales.data : null}
      today={today.ok ? today.data : null}
      adminSummary={adminSummary}
    />
  );
}
