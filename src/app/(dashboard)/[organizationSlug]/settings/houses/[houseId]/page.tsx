import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { HouseDetailClient } from "@/features/farm-structure/components/farm-structure-settings-client";
import { getHouse, listHouseAreas } from "@/features/farm-structure/server/queries";

export default async function HouseDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; houseId: string }>;
}) {
  const { organizationSlug, houseId } = await params;
  await requireUserOrRedirect(`/${organizationSlug}/settings/houses/${houseId}`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  const [house, areas] = await Promise.all([getHouse(houseId), listHouseAreas(org.id, houseId)]);
  if (!house || house.organizationId !== org.id) notFound();
  return (
    <section>
      <h1>{house.name}</h1>
      <HouseDetailClient house={house} areas={areas} organizationSlug={org.slug} />
    </section>
  );
}
