import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { STAFF_ROLES } from "@/features/orders/lib/roles";
import { getTodayTasks } from "@/features/orders/server/order-actions";
import { TasksClient } from "./tasks-client";

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { organizationSlug } = await params;
  const { order: focusOrderId } = await searchParams;

  let ctx;
  try {
    ctx = await requireOrgRole(organizationSlug, STAFF_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const result = await getTodayTasks(organizationSlug);

  return (
    <TasksClient
      organizationSlug={organizationSlug}
      orgId={ctx.orgId}
      viewerId={ctx.userId}
      initialTasks={result.ok ? result.data.tasks : []}
      initialPeople={result.ok ? result.data.people : {}}
      focusOrderId={focusOrderId}
    />
  );
}
