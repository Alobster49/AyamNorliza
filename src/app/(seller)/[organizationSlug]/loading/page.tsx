import { redirect } from "next/navigation";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { DISPATCH_ROLES } from "@/features/logistics/lib/roles";
import { getDispatchBoard } from "@/features/logistics/server/dispatch-actions";
import { LoadingClient } from "@/features/logistics/components/loading-client";

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function LoadingPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  try {
    await requireOrgRole(organizationSlug, DISPATCH_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}/tasks`);
    }
    throw error;
  }

  const date = todayIsoDate();
  const result = await getDispatchBoard(organizationSlug, date);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return (
    <LoadingClient organizationSlug={organizationSlug} initialDate={date} initialData={result.data} />
  );
}
