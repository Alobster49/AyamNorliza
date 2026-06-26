import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { FlocksPageClient } from "@/features/flocks/components/flocks-client";
import { listFlocks } from "@/features/flocks/server/queries";
import { listSites } from "@/features/farm-structure/server/queries";

export default async function FlocksPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/flocks`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [flocks, sites] = await Promise.all([listFlocks(org.id), listSites(org.id)]);
  return <FlocksPageClient organizationSlug={org.slug} flocks={flocks} sites={sites} />;
}
