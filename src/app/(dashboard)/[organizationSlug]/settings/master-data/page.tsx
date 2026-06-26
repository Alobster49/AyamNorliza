import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { MasterDataClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import { listCodeSetsWithValues } from "@/features/farm-structure/server/queries";

export default async function MasterDataSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/master-data`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const codeSets = await listCodeSetsWithValues(org.id);
  return (
    <section className="min-w-0">
      <MasterDataClient organizationId={org.id} codeSets={codeSets} />
    </section>
  );
}
