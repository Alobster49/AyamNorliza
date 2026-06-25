import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug, listAuditLog } from "@/features/identity-access/server/queries";

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ eventType?: string; entityType?: string }>;
}) {
  const { organizationSlug } = await params;
  const { eventType, entityType } = await searchParams;
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  const { rows, total } = await listAuditLog({
    organizationId: org.id,
    eventType,
    entityType,
    limit: 100,
  });
  return (
    <section>
      <h1>Audit log ({total})</h1>
      <p>Append-only. Most recent first.</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Occurred at</th>
            <th>Event</th>
            <th>Entity</th>
            <th>Actor</th>
            <th>Source</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.occurredAt).toLocaleString()}</td>
              <td><code>{r.eventType}</code></td>
              <td>{r.entityType}{r.entityId ? ` (${r.entityId.slice(0, 8)})` : ""}</td>
              <td><code>{r.actorUserId ?? "-"}</code></td>
              <td>{r.source}</td>
              <td>{r.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
