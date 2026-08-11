import { notFound } from "next/navigation";
import { getOrders } from "@/features/orders/server/order-actions";
import { OrdersClient } from "./orders-client";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const result = await getOrders(organizationSlug);
  if (!result.ok) notFound();

  return (
    <OrdersClient organizationSlug={organizationSlug} initialOrders={result.data} />
  );
}
