import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { getDashboardSales } from "@/features/dashboard/server/analytics-actions";
import { bucketForRange, resolveRange } from "@/features/dashboard/analytics/date-range";
import { AnalyticsDashboard } from "@/features/dashboard/analytics/components/analytics-dashboard";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let timeZone: string;
  try {
    ({ timeZone } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${await getLocale()}/${organizationSlug}`);
    }
    throw error;
  }

  const initialRange = resolveRange("30d", timeZone);
  const sales = await getDashboardSales(
    organizationSlug,
    initialRange.from,
    initialRange.to,
    bucketForRange(initialRange.from, initialRange.to),
  );

  return (
    <AnalyticsDashboard
      organizationSlug={organizationSlug}
      timeZone={timeZone}
      initialRange={initialRange}
      initialSales={sales.ok ? sales.data : null}
    />
  );
}
