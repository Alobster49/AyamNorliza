import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { getOrderWithItems } from "@/features/seller/server/actions";
import { notFound } from "next/navigation";
import { OrderDetailClient } from "./order-detail-client";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; orderId: string }>;
}) {
  const { organizationSlug, orderId } = await params;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const order = await getOrderWithItems(orderId);

  return (
    <OrderDetailClient
      organizationSlug={organizationSlug}
      initialOrder={order}
    />
  );
}
