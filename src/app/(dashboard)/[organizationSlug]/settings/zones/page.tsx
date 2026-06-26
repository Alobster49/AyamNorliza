import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { ZonesPageClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import { listSites, listZones } from "@/features/farm-structure/server/queries";

export default async function ZonesSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/zones`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [sites, zones] = await Promise.all([listSites(org.id), listZones(org.id)]);
  return (
    <section className="min-w-0">
      <ZonesPageClient organizationId={org.id} sites={sites} zones={zones} />
    </section>
  );
}
