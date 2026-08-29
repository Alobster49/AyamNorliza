import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { resolvePermissionsForOrg } from "@/lib/auth/require-permission";
import { grantKey } from "@/lib/auth/rbac";
import { getOrders } from "@/features/orders/server/order-actions";
import { todayInTimeZone } from "@/lib/time/org-date";
import { OrdersClient } from "./orders-client";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  const { context, grants } = await resolvePermissionsForOrg(organizationSlug);
  if (!context || !grants.has(grantKey("orders", "view"))) {
    redirect(`/${await getLocale()}/${organizationSlug}`);
  }

  const today = todayInTimeZone(context.timeZone);
  const canReopen = grants.has(grantKey("orders.reopen", "use"));

  const result = await getOrders(organizationSlug);
  if (!result.ok) notFound();

  return (
    <OrdersClient
      organizationSlug={organizationSlug}
      canReopen={canReopen}
      initialOrders={result.data}
      today={today}
    />
  );
}
