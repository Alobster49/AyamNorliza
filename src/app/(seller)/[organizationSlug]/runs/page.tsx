import { getRuns } from "@/features/orders/server/order-actions";
import { RunsClient } from "./runs-client";

/**
 * Local calendar date, not UTC: the depot runs on Malaysian time, and
 * toISOString() would serve yesterday's runs to the early-morning shift.
 */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default async function RunsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const date = todayIso();
  const result = await getRuns(organizationSlug, date);

  return (
    <RunsClient
      organizationSlug={organizationSlug}
      initialDate={date}
      initialRuns={result.ok ? result.data : []}
    />
  );
}
