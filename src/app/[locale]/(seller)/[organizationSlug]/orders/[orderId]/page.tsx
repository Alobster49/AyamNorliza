import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission, resolvePermissionsForOrg } from "@/lib/auth/require-permission";
import { grantKey } from "@/lib/auth/rbac";
import { getOrderDetail } from "@/features/orders/server/order-actions";
import { OrderDetailClient } from "./order-detail-client";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; orderId: string }>;
}) {
  const { organizationSlug, orderId } = await params;

  try {
    await requirePermission(organizationSlug, "orders", "view");
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const { grants } = await resolvePermissionsForOrg(organizationSlug);
  const canReopen = grants.has(grantKey("orders.reopen", "use"));

  const result = await getOrderDetail(organizationSlug, orderId);
  if (!result.ok) notFound();

  return (
    <OrderDetailClient
      organizationSlug={organizationSlug}
      canReopen={canReopen}
      initialOrder={result.data}
    />
  );
}
