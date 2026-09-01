"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { messageForDenial, requirePermission, resolvePermissionsForOrg, type PermissionContext } from "@/lib/auth/require-permission";
import { grantKey } from "@/lib/auth/rbac";
import type { ActionResult } from "@/features/orders/types";
import { todayInTimeZone, shiftIsoDate } from "@/lib/time/org-date";
import {
  buildRoster,
  type RosterInput,
  type RosterView,
} from "../lib/roster-model";

export type RosterData = {
  view: RosterView;
  fromDate: string;
  days: number;
  today: string;
  canEdit: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 42;
const KEY = "errors.logistics.roster";

function err<T = never>(code: string, message: string, messageKey: string): ActionResult<T> {
  return { ok: false, code, message, messageKey };
}
function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function permissionKey(message: string): string {
  if (message === "Not authenticated") return `${KEY}.unauthenticated`;
  if (message === "Organization not found") return `${KEY}.orgNotFound`;
  return `${KEY}.forbidden`;
}

/**
 * Trigger messages from 20260903000001_driver_roster.sql -> curated copy +
 * i18n keys. Never forwards the raw Postgres error text to the client —
 * mirrors `mapRpcError` in dispatch-actions.ts.
 */
function writeErrorKey(message: string): { code: string; message: string; messageKey: string } {
  if (message.includes("driver_on_leave")) {
    return { code: "driver_on_leave", message: "That driver is on approved leave that day.", messageKey: `${KEY}.driverOnLeave` };
  }
  if (message.includes("driver_double_booked")) {
    return {
      code: "driver_double_booked",
      message: "That driver is already covering another truck that day.",
      messageKey: `${KEY}.driverDoubleBooked`,
    };
  }
  if (message.includes("driver_not_member")) {
    return {
      code: "driver_not_member",
      message: "That person is not an active driver in this organization.",
      messageKey: `${KEY}.driverNotMember`,
    };
  }
  if (message.includes("truck_org_mismatch")) {
    return { code: "validation", message: "That roster change is not valid.", messageKey: `${KEY}.validation` };
  }
  return { code: "internal", message: "Could not save the roster change.", messageKey: `${KEY}.internal` };
}

async function guard(
  organizationSlug: string,
  action: "view" | "edit",
): Promise<{ ok: true; ctx: PermissionContext } | { ok: false; result: ActionResult<never> }> {
  try {
    const ctx = await requirePermission(organizationSlug, "driver_roster", action);
    return { ok: true, ctx };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, result: err("forbidden", e.message, permissionKey(e.message)) };
    }
    throw e;
  }
}

export async function getDriverRoster(
  organizationSlug: string,
  fromDate: string,
  days: number,
): Promise<ActionResult<RosterData>> {
  // Single lookup for both the view gate and the edit-grant check `canEdit`
  // derives from, rather than two separate `requirePermission` round trips.
  const { context, grants, reason } = await resolvePermissionsForOrg(organizationSlug);
  if (!context || !grants.has(grantKey("driver_roster", "view"))) {
    const message = messageForDenial(reason);
    return err("forbidden", message, permissionKey(message));
  }
  if (!ISO_DATE.test(fromDate) || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return err("validation", "Invalid roster window.", `${KEY}.validation`);
  }
  const { orgId, timeZone } = context;
  const toDate = shiftIsoDate(fromDate, days - 1);
  const canEdit = grants.has(grantKey("driver_roster", "edit"));

  const supabase = await createSupabaseServerClient();
  const [trucks, slots, blocks, holidays, leave, types, covers, runs, members] = await Promise.all([
    supabase.from("trucks").select("id, code, name, regular_driver_id").eq("organization_id", orgId).eq("is_active", true).order("code"),
    supabase.from("delivery_slots").select("truck_id, weekday").eq("organization_id", orgId).eq("is_active", true),
    supabase.from("schedule_blocks").select("block_date, truck_id").eq("organization_id", orgId).gte("block_date", fromDate).lte("block_date", toDate),
    supabase.from("public_holidays").select("holiday_date, name").eq("organization_id", orgId).gte("holiday_date", fromDate).lte("holiday_date", toDate),
    supabase.from("leave_roster").select("user_id, leave_type_id, start_date, end_date, status").eq("organization_id", orgId).lte("start_date", toDate).gte("end_date", fromDate),
    supabase.from("leave_types").select("id, name").eq("organization_id", orgId),
    supabase.from("truck_covers").select("truck_id, cover_date, driver_id, note").eq("organization_id", orgId).gte("cover_date", fromDate).lte("cover_date", toDate),
    supabase.from("delivery_runs").select("truck_id, run_date, driver_id").eq("organization_id", orgId).gte("run_date", fromDate).lte("run_date", toDate),
    supabase.from("organization_members").select("user_id").eq("organization_id", orgId).eq("role", "driver").eq("status", "active"),
  ]);
  const failed = [trucks, slots, blocks, holidays, leave, types, covers, runs, members].find((r) => r.error);
  if (failed) return err("internal", "Failed to load the roster.", `${KEY}.internal`);

  const driverIds = (members.data ?? []).map((m) => m.user_id);
  const { data: profiles } = driverIds.length
    ? await supabase.from("profiles").select("user_id, display_name").in("user_id", driverIds)
    : { data: [] as { user_id: string; display_name: string }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));
  const typeName = new Map((types.data ?? []).map((t) => [t.id, t.name]));
  const regularTruckOf = new Map((trucks.data ?? []).filter((t) => t.regular_driver_id).map((t) => [t.regular_driver_id as string, t.id]));

  const weekdaysByTruck = new Map<string, number[]>();
  for (const s of slots.data ?? []) {
    const list = weekdaysByTruck.get(s.truck_id) ?? [];
    if (!list.includes(s.weekday)) list.push(s.weekday);
    weekdaysByTruck.set(s.truck_id, list);
  }

  // `leave_roster` is a view (see database.generated.ts) and every column
  // comes back nullable even though the underlying `leave_requests` rows
  // always populate them. Rather than coerce a missing key to "" (which
  // would silently fabricate a leave row for an empty user id), drop rows
  // that are missing a field the model actually keys or ranges on.
  const leaveRows = (leave.data ?? []).filter(
    (l): l is typeof l & { user_id: string; start_date: string; end_date: string; status: string } =>
      l.user_id !== null && l.start_date !== null && l.end_date !== null && l.status !== null && (l.status === "approved" || l.status === "pending"),
  );

  const input: RosterInput = {
    fromDate,
    days,
    today: todayInTimeZone(timeZone),
    trucks: (trucks.data ?? []).map((t) => ({
      id: t.id, code: t.code, name: t.name, regularDriverId: t.regular_driver_id,
      operatingWeekdays: weekdaysByTruck.get(t.id) ?? [],
    })),
    drivers: driverIds
      .map((id) => ({ userId: id, name: nameOf.get(id) ?? "Driver", regularTruckId: regularTruckOf.get(id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    leave: leaveRows.map((l) => ({
      userId: l.user_id, startDate: l.start_date, endDate: l.end_date,
      status: l.status as "approved" | "pending", typeName: (l.leave_type_id && typeName.get(l.leave_type_id)) || "Leave",
    })),
    covers: (covers.data ?? []).map((c) => ({ truckId: c.truck_id, date: c.cover_date, driverId: c.driver_id, note: c.note })),
    runs: (runs.data ?? []).map((r) => ({ truckId: r.truck_id, runDate: r.run_date, driverId: r.driver_id })),
    blocks: (blocks.data ?? []).map((b) => ({ date: b.block_date, truckId: b.truck_id })),
    holidays: (holidays.data ?? []).map((h) => ({ date: h.holiday_date, name: h.name })),
  };

  return ok({ view: buildRoster(input), fromDate, days, today: input.today, canEdit });
}

export async function setRegularDriver(
  organizationSlug: string,
  truckId: string,
  driverId: string | null,
): Promise<ActionResult> {
  const g = await guard(organizationSlug, "edit");
  if (!g.ok) return g.result;
  const supabase = await createSupabaseServerClient();
  // `trucks_update` is gated by delivery_runs:edit, not driver_roster:edit, so
  // a custom role that holds only the roster grant gets error === null and
  // zero rows updated. Select the ids back and treat "nothing matched" as a
  // denial rather than reporting a save that never happened.
  const { data, error } = await supabase
    .from("trucks")
    .update({ regular_driver_id: driverId })
    .eq("id", truckId)
    .eq("organization_id", g.ctx.orgId)
    .select("id");
  if (error) {
    const mapped = writeErrorKey(error.message);
    return err(mapped.code, mapped.message, mapped.messageKey);
  }
  if ((data ?? []).length === 0) {
    return err("forbidden", "You do not have permission to change this truck's driver.", `${KEY}.forbidden`);
  }
  revalidatePath(`/${organizationSlug}/roster`);
  return ok(undefined);
}

export async function assignCover(
  organizationSlug: string,
  truckId: string,
  date: string,
  driverId: string,
  note?: string,
): Promise<ActionResult> {
  const g = await guard(organizationSlug, "edit");
  if (!g.ok) return g.result;
  if (!ISO_DATE.test(date) || !driverId || !truckId) {
    return err("validation", "Invalid cover.", `${KEY}.validation`);
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("truck_covers").upsert(
    {
      organization_id: g.ctx.orgId,
      truck_id: truckId,
      cover_date: date,
      driver_id: driverId,
      note: note?.trim() ? note.trim().slice(0, 200) : null,
      created_by: g.ctx.userId,
    },
    { onConflict: "truck_id,cover_date" },
  );
  if (error) {
    const mapped = writeErrorKey(error.message);
    return err(mapped.code, mapped.message, mapped.messageKey);
  }
  revalidatePath(`/${organizationSlug}/roster`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}

export async function clearCover(
  organizationSlug: string,
  truckId: string,
  date: string,
): Promise<ActionResult> {
  const g = await guard(organizationSlug, "edit");
  if (!g.ok) return g.result;
  if (!ISO_DATE.test(date) || !truckId) {
    return err("validation", "Invalid cover.", `${KEY}.validation`);
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("truck_covers")
    .delete()
    .eq("organization_id", g.ctx.orgId)
    .eq("truck_id", truckId)
    .eq("cover_date", date);
  if (error) {
    const mapped = writeErrorKey(error.message);
    return err(mapped.code, mapped.message, mapped.messageKey);
  }
  revalidatePath(`/${organizationSlug}/roster`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}
