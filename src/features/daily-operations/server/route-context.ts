import "server-only";

import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";

export async function requireDailyOperationsOrg(organizationSlug: string, returnTo: string) {
  await requireUserOrRedirect(returnTo);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  await requireOrgMember(org.id);
  return org;
}
