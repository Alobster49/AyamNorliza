import { notFound } from "next/navigation";
import { RoundCaptureClient } from "@/features/daily-operations/components/daily-operations-client";
import { getHouseRoundContext, getInspection } from "@/features/daily-operations/server/queries";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function InspectionRoundPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; inspectionId: string }>;
}) {
  const { organizationSlug, inspectionId } = await params;
  const org = await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/rounds/${inspectionId}`);
  const detail = await getInspection(inspectionId);
  if (!detail.inspection || detail.inspection.organizationId !== org.id) notFound();
  const round = await getHouseRoundContext(org.id, detail.inspection.houseId);
  if (!round) notFound();
  return (
    <RoundCaptureClient
      organizationId={org.id}
      organizationSlug={org.slug}
      round={{ ...round, inspectionId: detail.inspection.id, status: detail.inspection.status === "submitted" ? "submitted" : "in_progress" }}
      template={detail.template}
      inspection={detail.inspection}
    />
  );
}
