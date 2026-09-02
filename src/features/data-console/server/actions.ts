"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin, type AdminContext } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit/events";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { CONSOLE_ACCOUNTS, REALWORLD_DRIVER_ACCOUNTS } from "../lib/accounts";

// Committed on purpose: pilot-only demo logins, accepted risk documented in
// docs/superpowers/specs/2026-08-22-data-console-design.md.
const CONSOLE_PASSWORD = "password123";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "forbidden" | "internal"; message: string };

async function guardOwner(organizationSlug: string) {
  try {
    return await requirePermission(organizationSlug, "data_console.manage", "use");
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
      actorRole: ctx.roleKey,
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

  // Resetting a password revokes that account's sessions, so realigning the
  // seeder's own login would sign them out of the page they just clicked
  // Seed on. Their account already exists (they are signed in as it), so
  // skip the password step for it and only re-assert profile + membership.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: actingUser },
  } = await supabase.auth.getUser();
  const actingEmail = actingUser?.email?.toLowerCase() ?? null;

  const driverUserIds: string[] = [];
  try {
    for (const account of CONSOLE_ACCOUNTS) {
      const isSelf = account.email.toLowerCase() === actingEmail;
      const userId = isSelf
        ? ctx.userId
        : await admin.ensureUserWithPassword({
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
      if (account.role === "driver") driverUserIds.push(userId);
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : "";
    return {
      ok: false,
      code: "internal",
      message: `Could not ensure the console accounts — seeding was not started.${detail ? ` ${detail}` : ""}`,
    };
  }

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

  // Hand the seeded runs to the seeded drivers, round-robin. The SQL seed
  // cannot do this itself -- it never sees the auth user ids -- and a run
  // with no driver leaves the driver deck empty, which is the one screen a
  // driver login exists to open. A failure here is not fatal: the data is
  // already seeded and the office can assign a driver by hand.
  if (driverUserIds.length > 0) {
    const { data: runs } = await supabase
      .from("delivery_runs")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .neq("status", "completed")
      .order("run_date", { ascending: true });
    for (const [i, run] of (runs ?? []).entries()) {
      await supabase.rpc("dispatch_assign_driver", {
        p_run: run.id,
        p_driver: driverUserIds[i % driverUserIds.length],
      });
    }
  }

  const auditCtx = ctxFor(ctx.userId);
  await recordAudit(
    {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      actorRole: ctx.roleKey,
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

export async function seedSetupData(
  organizationSlug: string,
): Promise<ActionResult<{ summary: Record<string, number> }>> {
  const ctx = await guardOwner(organizationSlug);
  if (!ctx) return { ok: false, code: "forbidden", message: "Owner only." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_seed_setup_data", {
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
      actorRole: ctx.roleKey,
      eventType: "org.data_seeded",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { ...summary, mode: "setup_only" },
      correlationId: auditCtx.correlationId,
      source: "web",
    },
    auditCtx,
  );

  revalidatePath(`/${organizationSlug}`, "layout");
  return { ok: true, data: { summary } };
}

export async function seedRealworldData(
  organizationSlug: string,
): Promise<ActionResult<{ summary: Record<string, number> }>> {
  const ctx = await guardOwner(organizationSlug);
  if (!ctx) return { ok: false, code: "forbidden", message: "Admin only." };

  // Same self-skip rule as seedDemoData: never reset the seeder's own
  // password mid-session.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: actingUser },
  } = await supabase.auth.getUser();
  const actingEmail = actingUser?.email?.toLowerCase() ?? null;

  // Office accounts stay the demo set; the driver fleet is the 32 real-world
  // drivers: one per truck plus two in the cover pool. p_drivers maps
  // JHR-<N> -> auth user id (the truck's regular driver) and "pool" -> the
  // cover drivers, so the SQL seed can set regular drivers, book leave and
  // assign covers in one transaction.
  const officeAccounts = CONSOLE_ACCOUNTS.filter((a) => a.role !== "driver");
  const driverMap: Record<string, string | string[]> = {};
  const pool: string[] = [];
  try {
    for (const account of officeAccounts) {
      const isSelf = account.email.toLowerCase() === actingEmail;
      const userId = isSelf
        ? ctx.userId
        : await admin.ensureUserWithPassword({
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
    for (const driver of REALWORLD_DRIVER_ACCOUNTS) {
      const isSelf = driver.email.toLowerCase() === actingEmail;
      const userId = isSelf
        ? ctx.userId
        : await admin.ensureUserWithPassword({
            email: driver.email,
            password: CONSOLE_PASSWORD,
            displayName: driver.displayName,
          });
      await admin.upsertProfileAndMembership({
        userId,
        displayName: driver.displayName,
        organizationId: ctx.orgId,
        role: driver.role,
        invitedBy: ctx.userId,
      });
      if (driver.truckCode) driverMap[driver.truckCode] = userId;
      else pool.push(userId);
    }
    driverMap.pool = pool;
  } catch (e) {
    const detail = e instanceof Error ? e.message : "";
    return {
      ok: false,
      code: "internal",
      message: `Could not ensure the console accounts — seeding was not started.${detail ? ` ${detail}` : ""}`,
    };
  }

  const { data, error } = await supabase.rpc("admin_seed_realworld_data", {
    p_organization_id: ctx.orgId,
    p_drivers: driverMap,
  });
  if (error) {
    const forbidden = error.message === "forbidden";
    return {
      ok: false,
      code: forbidden ? "forbidden" : "internal",
      message: forbidden ? "Admin only." : "Seeding failed and was rolled back.",
    };
  }
  const summary = (data ?? {}) as Record<string, number>;

  // The actual number of drivers mapped: one key per truck that got a
  // regular driver, plus the pool drivers (the "pool" key itself holds an
  // array, not a single driver, so it's subtracted back out).
  const driversSeeded = Object.keys(driverMap).length - 1 + pool.length;

  const auditCtx = ctxFor(ctx.userId);
  await recordAudit(
    {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      actorRole: ctx.roleKey,
      eventType: "org.data_seeded",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { ...summary, mode: "realworld", drivers: driversSeeded },
      correlationId: auditCtx.correlationId,
      source: "web",
    },
    auditCtx,
  );

  revalidatePath(`/${organizationSlug}`, "layout");
  return { ok: true, data: { summary } };
}
