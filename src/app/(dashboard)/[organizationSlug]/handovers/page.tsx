import { PlaceholderWorkflowClient } from "@/features/daily-operations/components/daily-operations-client";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function HandoversPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/handovers`);
  return <PlaceholderWorkflowClient title="Handovers" description="Shift-to-shift unresolved risk, restrictions, equipment state and next actions." />;
}
