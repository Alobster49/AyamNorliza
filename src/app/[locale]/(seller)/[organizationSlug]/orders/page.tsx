import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
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
    redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    // Unreachable -- redirect throws. It is declared `=> never`, but
    // TypeScript only narrows on that for plain function declarations, and
    // this one is destructured off createNavigation(), so without an explicit
    // return the compiler still treats `context` as possibly null below.
    return null;
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
