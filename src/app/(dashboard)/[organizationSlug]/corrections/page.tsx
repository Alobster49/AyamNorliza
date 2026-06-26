import { PlaceholderWorkflowClient } from "@/features/daily-operations/components/daily-operations-client";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function CorrectionsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/corrections`);
  return <PlaceholderWorkflowClient title="Corrections" description="Before/after correction requests, reviewer reasons and locked-record protection." />;
}
