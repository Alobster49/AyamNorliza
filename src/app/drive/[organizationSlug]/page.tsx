import { getDriverRun } from "@/features/orders/server/driver-actions";
import { DriverDeck } from "@/features/orders/components/driver-deck";

export default async function DrivePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { organizationSlug } = await params;
  // ?run= lets the office open a driver's deck to record a drop phoned in.
  const { run: runId } = await searchParams;

  const result = await getDriverRun(organizationSlug, runId);

  if (!result.ok) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Can&apos;t open the run</h1>
        <p className="text-sm text-muted-foreground">{result.message}</p>
      </main>
    );
  }

  if (!result.data.run) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">No run for you today</h1>
        <p className="text-sm text-muted-foreground">
          The office has not put you on a truck yet. This page will show the run as soon as they do.
        </p>
      </main>
    );
  }

  return (
    <DriverDeck
      organizationSlug={organizationSlug}
      organizationId={result.data.organizationId}
      initialRun={result.data.run}
    />
  );
}
