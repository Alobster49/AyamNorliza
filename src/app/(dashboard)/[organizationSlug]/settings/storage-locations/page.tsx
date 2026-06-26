import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { StorageLocationsPageClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import {
  listSites,
  listStorageLocations,
  listZones,
} from "@/features/farm-structure/server/queries";

export default async function StorageLocationsSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/storage-locations`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [sites, zones, storageLocations] = await Promise.all([
    listSites(org.id),
    listZones(org.id),
    listStorageLocations(org.id),
  ]);
  return (
    <section className="min-w-0">
      <StorageLocationsPageClient
        organizationId={org.id}
        sites={sites}
        zones={zones}
        storageLocations={storageLocations}
      />
    </section>
  );
}
