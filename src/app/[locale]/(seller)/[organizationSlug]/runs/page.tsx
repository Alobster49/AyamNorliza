import { getRuns } from "@/features/orders/server/order-actions";
import { getOrgTimeZone } from "@/features/orders/server/guards";
import { todayInTimeZone } from "@/lib/time/org-date";
import { RunsClient } from "./runs-client";

export default async function RunsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  // The depot's calendar date. Server-local would be yesterday for the
  // early-morning shift on a UTC host; the browser's would disagree with this
  // page whenever the user is not in the org's own time zone.
  const timeZone = await getOrgTimeZone(organizationSlug);
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
