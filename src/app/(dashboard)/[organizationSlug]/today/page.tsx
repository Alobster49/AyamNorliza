import { TodayPageClient } from "@/features/daily-operations/components/daily-operations-client";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";
import { listTodayRounds } from "@/features/daily-operations/server/queries";

export default async function TodayPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const org = await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/today`);
  const rounds = await listTodayRounds(org.id);
  return <TodayPageClient organizationId={org.id} organizationSlug={org.slug} rounds={rounds} />;
}
