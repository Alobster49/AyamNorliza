import { redirect } from "next/navigation";
import { getIdentifierByCode } from "@/features/farm-structure/server/queries";
import { requireDailyOperationsOrg } from "@/features/daily-operations/server/route-context";

export default async function ScanResolverPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { organizationSlug } = await params;
  const { code } = await searchParams;
  const org = await requireDailyOperationsOrg(organizationSlug, `/${organizationSlug}/scan`);
  if (!code) redirect(`/${org.slug}/today`);
  const identifier = await getIdentifierByCode(org.id, code);
  if (identifier?.entityType === "house") redirect(`/${org.slug}/houses/${identifier.entityId}/round`);
  redirect(`/${org.slug}/today`);
}
