import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { OperationsOverviewClient } from "@/features/overview/components/operations-overview-client";
import { getOverviewDashboardSummary } from "@/features/overview/server/queries";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) return null;
  const summary = await getOverviewDashboardSummary(org.id);

  return (
    <OperationsOverviewClient
      organizationName={org.name}
      organizationSlug={organizationSlug}
      summary={summary}
    />
  );
}
