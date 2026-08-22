import { redirect } from "next/navigation";
import { todayInTimeZone } from "@/lib/time/org-date";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { DISPATCH_ROLES } from "@/features/logistics/lib/roles";
import { getDispatchBoard } from "@/features/logistics/server/dispatch-actions";
import { DispatchClient } from "@/features/logistics/components/dispatch-client";

export default async function DispatchPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let timeZone: string;
  try {
    ({ timeZone } = await requireOrgRole(organizationSlug, DISPATCH_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}/tasks`);
    }
    throw error;
  }

  // The depot's date, not the server's: on a UTC host `new Date()` serves the
  // early-morning shift yesterday's board.
  const date = todayInTimeZone(timeZone);
  const result = await getDispatchBoard(organizationSlug, date);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return (
    <DispatchClient organizationSlug={organizationSlug} initialDate={date} initialData={result.data} />
  );
}
