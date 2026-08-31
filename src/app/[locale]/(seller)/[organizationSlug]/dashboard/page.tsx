import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import {
  getDashboardInsights,
  getDashboardSales,
  getDashboardToday,
} from "@/features/dashboard/server/analytics-actions";
import { bucketForRange, resolveRange } from "@/features/dashboard/analytics/date-range";
import { AnalyticsDashboard } from "@/features/dashboard/analytics/components/analytics-dashboard";
import { getMarketSuggestions } from "@/features/market/server/actions";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let orgId: string;
  let timeZone: string;
  try {
    ({ orgId, timeZone } = await requirePermission(organizationSlug, "dashboard", "view"));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const initialRange = resolveRange("30d", timeZone);
  const [sales, today, insights, marketSuggestions] = await Promise.all([
    getDashboardSales(
      organizationSlug,
      initialRange.from,
      initialRange.to,
      bucketForRange(initialRange.from, initialRange.to),
    ),
    getDashboardToday(organizationSlug),
    getDashboardInsights(organizationSlug, initialRange.from, initialRange.to),
    getMarketSuggestions(orgId).catch(() => []),
  ]);

  return (
    <AnalyticsDashboard
      organizationSlug={organizationSlug}
      timeZone={timeZone}
      initialRange={initialRange}
      initialSales={sales.ok ? sales.data : null}
      today={today.ok ? today.data : null}
      initialInsights={insights.ok ? insights.data : null}
      marketSuggestions={marketSuggestions}
    />
  );
}
