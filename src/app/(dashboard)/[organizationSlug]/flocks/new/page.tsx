import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { NewFlockPageClient } from "@/features/flocks/components/flocks-client";
import {
  listHouses,
  listProductionProfiles,
  listSites,
  listTargetProfileVersions,
} from "@/features/farm-structure/server/queries";

export default async function NewFlockPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/flocks/new`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [sites, houses, productionProfiles, targetVersions] = await Promise.all([
    listSites(org.id),
    listHouses(org.id),
    listProductionProfiles(org.id),
    listTargetProfileVersions(org.id),
  ]);
  return (
    <NewFlockPageClient
      organizationId={org.id}
      organizationSlug={org.slug}
      sites={sites}
      houses={houses}
      productionProfiles={productionProfiles}
      targetVersions={targetVersions}
    />
  );
}
