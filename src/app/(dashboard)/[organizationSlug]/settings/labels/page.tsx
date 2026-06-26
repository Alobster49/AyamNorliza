import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { LabelsClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import { listIdentifiers } from "@/features/farm-structure/server/queries";

export default async function LabelsSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/labels`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const identifiers = await listIdentifiers(org.id);
  return (
    <section className="min-w-0">
      <LabelsClient organizationId={org.id} organizationSlug={org.slug} identifiers={identifiers} />
    </section>
  );
}
