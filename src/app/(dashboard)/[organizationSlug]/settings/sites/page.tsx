import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { SitesPageClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import { listSites } from "@/features/farm-structure/server/queries";

export default async function SitesSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/sites`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const sites = await listSites(org.id);
  return (
    <section className="min-w-0">
      <SitesPageClient organizationId={org.id} organizationSlug={org.slug} sites={sites} />
    </section>
  );
}
