import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { getCustomers } from "@/features/seller/server/actions";
import { notFound } from "next/navigation";
import { CustomersClient } from "./customers-client";

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const customers = await getCustomers(org.id);

  return (
    <CustomersClient
      organizationSlug={organizationSlug}
      organizationId={org.id}
      initialCustomers={customers}
    />
  );
}
