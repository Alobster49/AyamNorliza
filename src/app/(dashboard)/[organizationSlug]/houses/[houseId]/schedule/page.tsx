import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { FlocksPageClient } from "@/features/flocks/components/flocks-client";
import { listFlocksForHouse } from "@/features/flocks/server/queries";
import { getHouse, listSites } from "@/features/farm-structure/server/queries";

export default async function HouseSchedulePage({
  params,
}: {
  params: Promise<{ organizationSlug: string; houseId: string }>;
}) {
  const { organizationSlug, houseId } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/houses/${houseId}/schedule`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [house, flocks, sites] = await Promise.all([
    getHouse(houseId),
    listFlocksForHouse(org.id, houseId),
    listSites(org.id),
  ]);
  if (!house || house.organizationId !== org.id) notFound();
  return <FlocksPageClient organizationSlug={org.slug} flocks={flocks} sites={sites} />;
}
