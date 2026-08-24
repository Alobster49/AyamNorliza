import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { NewOrderClient } from "./new-order-client";

export default async function NewOrderPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  try {
    await requireOrgRole(organizationSlug, MANAGER_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  return (
    <NewOrderClient
      organizationSlug={organizationSlug}
      organizationId={org.id}
    />
  );
}
