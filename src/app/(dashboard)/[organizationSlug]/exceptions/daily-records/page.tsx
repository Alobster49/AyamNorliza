import { ExceptionsPageClient } from "@/features/daily-operations/components/daily-operations-client";
import { listOpenObservations } from "@/features/daily-operations/server/queries";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function DailyRecordExceptionsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const org = await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/exceptions/daily-records`);
  const observations = await listOpenObservations(org.id);
  return <ExceptionsPageClient observations={observations} />;
}
