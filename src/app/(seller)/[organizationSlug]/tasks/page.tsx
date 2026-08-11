import { redirect } from "next/navigation";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { STAFF_ROLES } from "@/features/orders/lib/roles";
import { getTodayTasks } from "@/features/orders/server/order-actions";
import { TasksClient } from "./tasks-client";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  try {
    await requireOrgRole(organizationSlug, STAFF_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}`);
    }
    throw error;
  }

  const result = await getTodayTasks(organizationSlug);

  return (
    <TasksClient organizationSlug={organizationSlug} initialTasks={result.ok ? result.data : []} />
  );
}
