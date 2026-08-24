import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { getCustomers } from "@/features/seller/server/actions";
import { CustomersClient } from "./customers-client";

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let orgId: string;
  try {
    ({ orgId } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const customers = await getCustomers(orgId);

  return (
    <CustomersClient
      organizationSlug={organizationSlug}
      organizationId={orgId}
      initialCustomers={customers}
    />
  );
}
