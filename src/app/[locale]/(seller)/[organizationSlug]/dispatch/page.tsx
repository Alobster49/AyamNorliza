import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { todayInTimeZone } from "@/lib/time/org-date";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
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
    ({ timeZone } = await requirePermission(organizationSlug, "dispatch", "view"));
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
    <DispatchClient
      organizationSlug={organizationSlug}
      initialDate={date}
      initialData={result.data}
      timeZone={timeZone}
    />
  );
}
