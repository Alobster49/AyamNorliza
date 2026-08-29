import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { todayInTimeZone } from "@/lib/time/org-date";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { DISPATCH_ROLES } from "@/features/logistics/lib/roles";
import { getDispatchBoard } from "@/features/logistics/server/dispatch-actions";
import { LoadingClient } from "@/features/logistics/components/loading-client";

export default async function LoadingPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let timeZone: string;
  let orgId: string;
  let userId: string;
  try {
    ({ timeZone, orgId, userId } = await requireOrgRole(organizationSlug, DISPATCH_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
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
    <LoadingClient
      organizationSlug={organizationSlug}
      orgId={orgId}
      viewerId={userId}
      initialDate={date}
      initialData={result.data}
    />
  );
}
