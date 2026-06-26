import { RoundsPageClient } from "@/features/daily-operations/components/daily-operations-client";
import { listInspections, listTodayRounds } from "@/features/daily-operations/server/queries";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function RoundsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const org = await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/rounds`);
  const [rounds, inspections] = await Promise.all([listTodayRounds(org.id), listInspections(org.id)]);
  return <RoundsPageClient organizationId={org.id} organizationSlug={org.slug} rounds={rounds} inspections={inspections} />;
}
