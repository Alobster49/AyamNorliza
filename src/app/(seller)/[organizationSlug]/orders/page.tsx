import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { getOrders } from "@/features/seller/server/actions";
import { notFound } from "next/navigation";
import { OrdersClient } from "./orders-client";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const orders = await getOrders(org.id);

  return (
    <OrdersClient
      organizationSlug={organizationSlug}
      initialOrders={orders}
    />
  );
}
