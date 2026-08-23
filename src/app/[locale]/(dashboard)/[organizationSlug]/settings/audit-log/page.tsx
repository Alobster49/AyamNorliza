import { notFound } from "next/navigation";

import { ScrollText } from "lucide-react";

import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug, listAuditLog } from "@/features/identity-access/server/queries";
import { AuditLogClient } from "@/features/identity-access/components/audit-log-client";

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    eventType?: string;
    entityType?: string;
    source?: string;
    query?: string;
    row?: string;
  }>;
}) {
  const { organizationSlug } = await params;
  const sp = await searchParams;
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const { rows, total } = await listAuditLog({
    organizationId: org.id,
    eventType: sp.eventType,
    entityType: sp.entityType,
    limit: 200,
  });

  const eventTypes = Array.from(
    new Set(rows.map((r) => r.eventType)),
  ).sort();
  const entityTypes = Array.from(
    new Set(rows.map((r) => r.entityType)),
  ).sort();
  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();

  const actorIds = new Set(
    rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)),
  );

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <ScrollText className="size-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Audit log
            </h1>
            <p className="text-sm text-muted-foreground">
              Append-only record of every privileged action. Most recent first.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-left sm:grid-cols-3">
          <Stat label="Events" value={total.toLocaleString()} />
          <Stat label="Actors" value={actorIds.size.toLocaleString()} />
          <Stat label="Distinct" value={eventTypes.length.toLocaleString()} />
        </div>
      </header>

      <AuditLogClient
        rows={rows}
        filters={{
          eventTypes,
          entityTypes,
          sources,
        }}
        active={{
          eventType: sp.eventType ?? "",
          entityType: sp.entityType ?? "",
          source: sp.source ?? "",
          query: sp.query ?? "",
          rowId: sp.row ?? "",
        }}
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-base leading-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}
