import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { getRuns } from "@/features/orders/server/order-actions";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { todayInTimeZone } from "@/lib/time/org-date";
import { RunsClient } from "./runs-client";

export default async function RunsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let timeZone: string;
  try {
    ({ timeZone } = await requirePermission(organizationSlug, "delivery_runs", "view"));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
    }
    throw error;
  }

  // The depot's calendar date. Server-local would be yesterday for the
  // early-morning shift on a UTC host; the browser's would disagree with this
  // page whenever the user is not in the org's own time zone.
  const date = todayInTimeZone(timeZone);
  const result = await getRuns(organizationSlug, date);

  return (
    <RunsClient
      organizationSlug={organizationSlug}
      initialDate={date}
      timeZone={timeZone}
      initialRuns={result.ok ? result.data : []}
    />
  );
}
