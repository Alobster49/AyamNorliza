import { notFound } from "next/navigation";

import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { OrganizationSettingsClient } from "./organization-settings-client";

export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  return (
    <OrganizationSettingsClient
      organizationId={org.id}
      name={org.name}
      legalName={org.legalName}
      region={org.region}
      defaultTimeZone={org.defaultTimeZone}
      defaultLocale={org.defaultLocale}
    />
  );
}