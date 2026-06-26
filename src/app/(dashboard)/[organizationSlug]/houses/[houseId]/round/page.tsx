import { notFound } from "next/navigation";
import { RoundCaptureClient } from "@/features/daily-operations/components/daily-operations-client";
import { getHouseRoundContext, getTemplateVersion } from "@/features/daily-operations/server/queries";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function HouseRoundPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; houseId: string }>;
}) {
  const { organizationSlug, houseId } = await params;
  const org = await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/houses/${houseId}/round`);
  const round = await getHouseRoundContext(org.id, houseId);
  if (!round) notFound();
  const template = round.templateVersionId ? await getTemplateVersion(round.templateVersionId) : null;
  return <RoundCaptureClient organizationId={org.id} organizationSlug={org.slug} round={round} template={template} inspection={null} />;
}
