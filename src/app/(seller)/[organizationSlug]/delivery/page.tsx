import { redirect } from "next/navigation";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { getDeliverySetup } from "@/features/orders/server/schedule-actions";
import { DeliveryClient } from "./delivery-client";

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  try {
    await requireOrgRole(organizationSlug, MANAGER_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}/tasks`);
    }
    throw error;
  }

  const result = await getDeliverySetup(organizationSlug);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return <DeliveryClient organizationSlug={organizationSlug} initialSetup={result.data} />;
}
