import { getRuns } from "@/features/orders/server/order-actions";
import { RunsClient } from "./runs-client";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
