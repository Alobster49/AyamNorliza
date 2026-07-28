import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { notFound } from "next/navigation";
import { NewOrderClient } from "./new-order-client";

export default async function NewOrderPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  return (
    <NewOrderClient
      organizationSlug={organizationSlug}
      organizationId={org.id}
    />
  );
}
