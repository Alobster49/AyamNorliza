import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { SiteDetailClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import {
  getSite,
  listHouses,
  listStorageLocations,
  listZones,
} from "@/features/farm-structure/server/queries";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; siteId: string }>;
}) {
  const { organizationSlug, siteId } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/sites/${siteId}`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [site, zones, houses, storageLocations] = await Promise.all([
    getSite(siteId),
    listZones(org.id, siteId),
    listHouses(org.id, siteId),
    listStorageLocations(org.id, siteId),
  ]);
  if (!site || site.organizationId !== org.id) notFound();
  return (
    <section className="min-w-0">
      <SiteDetailClient
        site={site}
        zones={zones}
        houses={houses}
        storageLocations={storageLocations}
        organizationSlug={org.slug}
      />
    </section>
  );
}
