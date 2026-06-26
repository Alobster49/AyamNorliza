import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { TargetProfilesPageClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import {
  listTargetProfileVersions,
  listTargetProfiles,
} from "@/features/farm-structure/server/queries";

export default async function TargetProfilesSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/target-profiles`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [targetProfiles, targetProfileVersions] = await Promise.all([
    listTargetProfiles(org.id),
    listTargetProfileVersions(org.id),
  ]);
  return (
    <section className="min-w-0">
      <TargetProfilesPageClient
        organizationId={org.id}
        organizationSlug={org.slug}
        targetProfiles={targetProfiles}
        targetProfileVersions={targetProfileVersions}
      />
    </section>
  );
}
