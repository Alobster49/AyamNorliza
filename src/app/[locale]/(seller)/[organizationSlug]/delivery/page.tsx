import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission, resolvePermissionsForOrg } from "@/lib/auth/require-permission";
import { grantKey } from "@/lib/auth/rbac";
import { getDeliverySetup } from "@/features/orders/server/schedule-actions";
import { getLogisticsSetup } from "@/features/logistics/server/facility-actions";
import { DeliveryClient } from "./delivery-client";

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  await (async () => {
    try {
      return await requirePermission(organizationSlug, "delivery_setup", "view");
    } catch (error) {
      if (error instanceof OrderPermissionError) {
        redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
      }
      throw error;
    }
  })();

  const { grants } = await resolvePermissionsForOrg(organizationSlug);
  const canEdit = grants.has(grantKey("delivery_setup", "edit"));

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
      canEdit={canEdit}
    />
  );
}
