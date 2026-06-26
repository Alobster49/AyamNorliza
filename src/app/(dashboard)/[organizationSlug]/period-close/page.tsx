import { PeriodClosePageClient } from "@/features/daily-operations/components/daily-operations-client";
import { listPeriodCloses, listTodayRounds } from "@/features/daily-operations/server/queries";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function PeriodClosePage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const org = await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/period-close`);
  const [closes, rounds] = await Promise.all([listPeriodCloses(org.id), listTodayRounds(org.id)]);
  return <PeriodClosePageClient organizationId={org.id} closes={closes} rounds={rounds} />;
}
