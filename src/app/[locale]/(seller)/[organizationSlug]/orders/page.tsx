import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { getOrders } from "@/features/orders/server/order-actions";
import { OrdersClient } from "./orders-client";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let callerRole: string;
  try {
    ({ role: callerRole } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const result = await getOrders(organizationSlug);
  if (!result.ok) notFound();

  return (
    <OrdersClient
      organizationSlug={organizationSlug}
      callerRole={callerRole}
      initialOrders={result.data}
    />
  );
}
