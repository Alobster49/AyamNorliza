import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { TargetVersionClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import { getTargetProfileVersion } from "@/features/farm-structure/server/queries";

export default async function TargetProfileVersionPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; profileId: string; versionId: string }>;
}) {
  const { organizationSlug, profileId, versionId } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/target-profiles/${profileId}/versions/${versionId}`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const { version, points } = await getTargetProfileVersion(versionId);
  if (!version || version.organizationId !== org.id || version.targetProfileId !== profileId) notFound();
  return (
    <section>
      <h1>Target profile version</h1>
      <TargetVersionClient organizationId={org.id} version={version} points={points} />
    </section>
  );
}
