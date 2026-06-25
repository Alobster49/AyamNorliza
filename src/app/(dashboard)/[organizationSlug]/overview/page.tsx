import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { OperationsOverviewClient } from "@/features/overview/components/operations-overview-client";
import { getOverviewDashboardSummary } from "@/features/overview/server/queries";

export default async function OverviewPage({
  params,
}: {
  params: { organizationSlug: string };
}) {
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(params.organizationSlug);
  if (!org) return null;
  const summary = await getOverviewDashboardSummary(org.id);

  return (
    <OperationsOverviewClient
      organizationName={org.name}
      organizationSlug={params.organizationSlug}
      summary={summary}
    />
  );
}
