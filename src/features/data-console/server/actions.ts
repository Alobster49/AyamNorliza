"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin, type AdminContext } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit/events";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { CONSOLE_ACCOUNTS } from "../lib/accounts";

// Committed on purpose: pilot-only demo logins, accepted risk documented in
// docs/superpowers/specs/2026-08-22-data-console-design.md.
const CONSOLE_PASSWORD = "Password123!";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "forbidden" | "internal"; message: string };

async function guardOwner(organizationSlug: string) {
  try {
    return await requireOrgRole(organizationSlug, ["owner"]);
  } catch (e) {
    if (e instanceof OrderPermissionError) return null;
    throw e;
  }
}

function ctxFor(userId: string): AdminContext {
  return { actorUserId: userId, correlationId: randomUUID() };
}

export async function clearAllData(
  organizationSlug: string,
): Promise<ActionResult<{ counts: Record<string, number> }>> {
  const ctx = await guardOwner(organizationSlug);
  if (!ctx) return { ok: false, code: "forbidden", message: "Owner only." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_clear_org_data", {
    p_organization_id: ctx.orgId,
  });
  if (error) {
    const forbidden = error.message === "forbidden";
    return {
      ok: false,
      code: forbidden ? "forbidden" : "internal",
      message: forbidden ? "Owner only." : "Clearing failed — nothing was deleted.",
    };
  }
  const counts = (data ?? {}) as Record<string, number>;

  const auditCtx = ctxFor(ctx.userId);
  await recordAudit(
    {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      eventType: "org.data_cleared",
      entityType: "organization",
      entityId: ctx.orgId,
      after: counts,
      correlationId: auditCtx.correlationId,
      source: "web",
    },
    auditCtx,
  );

  revalidatePath(`/${organizationSlug}`, "layout");
  return { ok: true, data: { counts } };
}

export async function seedDemoData(
  organizationSlug: string,
): Promise<ActionResult<{ summary: Record<string, number> }>> {
  const ctx = await guardOwner(organizationSlug);
  if (!ctx) return { ok: false, code: "forbidden", message: "Owner only." };

  try {
    for (const account of CONSOLE_ACCOUNTS) {
      const userId = await admin.ensureUserWithPassword({
        email: account.email,
        password: CONSOLE_PASSWORD,
        displayName: account.displayName,
      });
      await admin.upsertProfileAndMembership({
        userId,
        displayName: account.displayName,
        organizationId: ctx.orgId,
        role: account.role,
        invitedBy: ctx.userId,
      });
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : "";
    return {
      ok: false,
      code: "internal",
      message: `Could not ensure the console accounts — seeding was not started.${detail ? ` ${detail}` : ""}`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_seed_demo_data", {
    p_organization_id: ctx.orgId,
  });
  if (error) {
    const forbidden = error.message === "forbidden";
    return {
      ok: false,
      code: forbidden ? "forbidden" : "internal",
      message: forbidden ? "Owner only." : "Seeding failed and was rolled back.",
    };
  }
  const summary = (data ?? {}) as Record<string, number>;

  const auditCtx = ctxFor(ctx.userId);
  await recordAudit(
    {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      eventType: "org.data_seeded",
      entityType: "organization",
      entityId: ctx.orgId,
      after: summary,
      correlationId: auditCtx.correlationId,
      source: "web",
    },
    auditCtx,
  );

  revalidatePath(`/${organizationSlug}`, "layout");
  return { ok: true, data: { summary } };
}
