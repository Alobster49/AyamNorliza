/**
 * Append-only audit logging helpers used by Server Actions.
 *
 * The DB function `public.record_audit_event` is the source of truth (see
 * migration 20260624000003). This module wraps it for type safety and
 * correlation id propagation.
 */

import "server-only";

import { admin, type AdminContext } from "@/lib/supabase/admin";

export async function recordAudit(
  args: {
    organizationId: string | null;
    actorUserId: string | null;
    actorRole?: string | null;
    actorSessionId?: string | null;
    eventType: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    correlationId?: string | null;
    clientOperationId?: string | null;
    source?: "web" | "mobile" | "device" | "integration" | "job" | "import" | "server";
  },
  ctx: AdminContext,
): Promise<void> {
  await admin.insertAuditEvent(
    {
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole ?? null,
      actorSessionId: args.actorSessionId ?? null,
      eventType: args.eventType,
      entityType: args.entityType,
      entityId: args.entityId ?? null,
      before: args.before ?? null,
      after: args.after ?? null,
      reason: args.reason ?? null,
      correlationId: args.correlationId ?? null,
      clientOperationId: args.clientOperationId ?? null,
      source: args.source ?? "web",
    },
    ctx,
  );
}
