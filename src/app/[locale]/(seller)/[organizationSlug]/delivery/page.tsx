import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { getDeliverySetup } from "@/features/orders/server/schedule-actions";
import { getLogisticsSetup } from "@/features/logistics/server/facility-actions";
import { DeliveryClient } from "./delivery-client";

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  const ctx = await (async () => {
    try {
      return await requireOrgRole(organizationSlug, MANAGER_ROLES);
    } catch (error) {
      if (error instanceof OrderPermissionError) {
        redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
      }
      throw error;
    }
  })();

  const [result, logistics] = await Promise.all([
    getDeliverySetup(organizationSlug),
    getLogisticsSetup(organizationSlug),
  ]);
  if (!result.ok) throw new Error(result.message);
  if (!logistics.ok) throw new Error(logistics.message);

  return (
    <DeliveryClient
      organizationSlug={organizationSlug}
      initialSetup={result.data}
      logisticsSetup={logistics.data}
      role={ctx.role}
    />
  );
}
