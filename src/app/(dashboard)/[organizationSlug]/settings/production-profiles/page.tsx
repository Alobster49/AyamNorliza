import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { ProfilesPageClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import { listProductionProfiles } from "@/features/farm-structure/server/queries";

export default async function ProductionProfilesSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/production-profiles`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const productionProfiles = await listProductionProfiles(org.id);
  return (
    <section className="min-w-0">
      <ProfilesPageClient
        organizationId={org.id}
        productionProfiles={productionProfiles}
      />
    </section>
  );
}
