import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { getOrders } from "@/features/orders/server/order-actions";
import { todayInTimeZone } from "@/lib/time/org-date";
import { OrdersClient } from "./orders-client";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let callerRole: string;
  let timeZone: string;
  try {
    ({ roleKey: callerRole, timeZone } = await requirePermission(organizationSlug, "orders", "view"));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const today = todayInTimeZone(timeZone);

  const result = await getOrders(organizationSlug);
  if (!result.ok) notFound();

  return (
    <OrdersClient
      organizationSlug={organizationSlug}
      callerRole={callerRole}
      initialOrders={result.data}
      today={today}
    />
  );
}
