import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { getOrderDetail } from "@/features/orders/server/order-actions";
import { OrderDetailClient } from "./order-detail-client";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; orderId: string }>;
}) {
  const { organizationSlug, orderId } = await params;

  let callerRole: string;
  try {
    ({ role: callerRole } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const result = await getOrderDetail(organizationSlug, orderId);
  if (!result.ok) notFound();

  return (
    <OrderDetailClient
      organizationSlug={organizationSlug}
      callerRole={callerRole}
      initialOrder={result.data}
    />
  );
}
