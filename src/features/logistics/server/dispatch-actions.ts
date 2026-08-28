"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import type { ActionResult } from "@/features/orders/types";
import { suggestTruck, type AssignmentContext } from "../lib/assignment";
import { DISPATCH_ROLES } from "../lib/roles";
import type { DispatchBoardData, DispatchTicket, DispatchTruck, Facility, Bay, ZonePostcodeRange } from "../types";

type DispatchErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(code: DispatchErrorCode, message: string, messageKey?: string): ActionResult<T> {
  return { ok: false, code, message, ...(messageKey ? { messageKey } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * `OrderPermissionError.message` is prose from `guards.ts`, shared with
 * every order/logistics/driver action (mirrors `permissionMessageKey` in
 * order-actions.ts / driver-actions.ts).
 */
function dispatchPermissionMessageKey(message: string): string {
  if (message === "Not authenticated") return "errors.logistics.dispatch.unauthenticated";
  if (message === "Organization not found") return "errors.logistics.dispatch.orgNotFound";
  return "errors.logistics.dispatch.forbidden";
}

async function guardDispatch(
  organizationSlug: string,
): Promise<
  | { ok: true; orgId: string; userId: string }
  | { ok: false; code: "forbidden"; message: string; messageKey: string }
> {
  try {
    const ctx = await requireOrgRole(organizationSlug, DISPATCH_ROLES);
    return { ok: true, orgId: ctx.orgId, userId: ctx.userId };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return {
        ok: false,
        code: "forbidden",
        message: e.message,
        messageKey: dispatchPermissionMessageKey(e.message),
      };
    }
    throw e;
  }
}

/** Maps RPC P0001 message codes to friendly ActionResults. */
function mapRpcError<T = void>(message: string): ActionResult<T> {
  if (message.includes("deadlock detected") || message.includes("40P01")) {
    return err("conflict", "The board is busy — try that again.", "errors.logistics.dispatch.busy");
  }
  if (message.includes("run_departed")) {
    return err("conflict", "That run has already departed.", "errors.logistics.dispatch.runDeparted");
  }
  if (message.includes("invalid_status")) {
    return err(
      "conflict",
      "Only confirmed or ready orders can be dispatched.",
      "errors.logistics.dispatch.invalidStatus",
    );
  }
  if (message.includes("invalid_truck")) {
    return err(
      "conflict",
      "That truck is not active in this organization.",
      "errors.logistics.dispatch.invalidTruck",
    );
  }
  if (message.includes("not_assigned")) {
    return err("conflict", "That order is not on a truck yet.", "errors.logistics.dispatch.notAssigned");
  }
  if (message.includes("not_weighed")) {
    return err(
      "conflict",
      "That order has not been weighed yet — weigh it before loading.",
      "errors.logistics.dispatch.notWeighed",
    );
  }
  if (message.includes("forbidden")) {
    return err("forbidden", "You do not have access to dispatch.", "errors.logistics.dispatch.forbidden");
  }
  if (message.includes("not_found")) {
    return err("not_found", "Order not found.", "errors.logistics.dispatch.notFound");
  }
  return err("internal", message, "errors.logistics.dispatch.internal");
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Board read
// ---------------------------------------------------------------------------

export async function getDispatchBoard(
  organizationSlug: string,
  date: string,
): Promise<ActionResult<DispatchBoardData>> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  if (!DATE_REGEX.test(date)) return err("validation", "Invalid date");

  const supabase = await createSupabaseServerClient();
  const [facility, bays, trucks, zones, ranges, truckZones, slots, blocks, runs, orders] =
    await Promise.all([
      supabase.from("facilities").select("*").eq("organization_id", orgId).eq("is_active", true).limit(1).maybeSingle(),
      supabase.from("bays").select("*").eq("organization_id", orgId).order("position", { ascending: true }),
      supabase.from("trucks").select("*").eq("organization_id", orgId).order("code", { ascending: true }),
      supabase.from("delivery_zones").select("*").eq("organization_id", orgId).order("name", { ascending: true }),
      supabase.from("zone_postcode_ranges").select("*").eq("organization_id", orgId),
      supabase.from("truck_zones").select("*").eq("organization_id", orgId),
      supabase.from("delivery_slots").select("*").eq("organization_id", orgId),
      supabase.from("schedule_blocks").select("*").eq("organization_id", orgId).eq("block_date", date),
      supabase.from("delivery_runs").select("*").eq("organization_id", orgId).eq("run_date", date),
      supabase
        .from("orders")
        .select(
          "*, customer:customers(name), zone:delivery_zones(name), items:order_items(quantity, warehouse_weight_kg, warehouse_pieces, final_weight_kg, is_cancelled, product:products(name))",
        )
        .eq("organization_id", orgId)
        .eq("delivery_date", date)
        .in("status", ["confirmed", "ready"]),
    ]);

  if (
    facility.error || bays.error || trucks.error || zones.error || ranges.error ||
    truckZones.error || slots.error || blocks.error || runs.error || orders.error
  ) {
    return err("internal", "Failed to load the dispatch board");
  }

  return ok({
    facility: (facility.data ?? null) as Facility | null,
    bays: (bays.data ?? []) as Bay[],
    trucks: (trucks.data ?? []) as DispatchTruck[],
    zones: (zones.data ?? []) as DispatchBoardData["zones"],
    ranges: (ranges.data ?? []) as ZonePostcodeRange[],
    truckZones: (truckZones.data ?? []) as DispatchBoardData["truckZones"],
    slots: (slots.data ?? []) as DispatchBoardData["slots"],
    blocks: (blocks.data ?? []) as DispatchBoardData["blocks"],
    runs: (runs.data ?? []) as DispatchBoardData["runs"],
    orders: (orders.data ?? []) as DispatchTicket[],
  });
}

// ---------------------------------------------------------------------------
// Assign / unassign
// ---------------------------------------------------------------------------

const AssignInputSchema = z.object({
  orderId: z.string().uuid(),
  truckId: z.string().uuid(),
});

export async function assignOrder(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = AssignInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid assignment input", "errors.logistics.dispatch.invalidAssignInput");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_assign_order", {
    p_order: parsed.data.orderId,
    p_truck: parsed.data.truckId,
    p_source: "manual",
  });
  if (error) return mapRpcError(error.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok(undefined);
}

const UnassignInputSchema = z.object({ orderId: z.string().uuid() });

export async function unassignOrder(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = UnassignInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.logistics.dispatch.invalidUnassignInput");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_unassign_order", {
    p_order: parsed.data.orderId,
  });
  if (error) return mapRpcError(error.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Auto-assign (called after confirm; also usable from the board)
// ---------------------------------------------------------------------------

export async function autoAssignOrder(
  organizationSlug: string,
  orderId: string,
): Promise<ActionResult<{ assigned: boolean; reason?: string }>> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, postcode, delivery_date, slot_id, assignment_source, status")
    .eq("id", orderId)
    .eq("organization_id", orgId)
    .single();
  if (orderError || !order) return err("not_found", "Order not found");
  if (order.assignment_source === "manual") return ok({ assigned: false, reason: "manual" });

  const [zones, ranges, truckZones, trucks, slots, blocks, slotRow, loadRows] = await Promise.all([
    supabase.from("delivery_zones").select("*").eq("organization_id", orgId),
    supabase.from("zone_postcode_ranges").select("*").eq("organization_id", orgId),
    supabase.from("truck_zones").select("*").eq("organization_id", orgId),
    supabase.from("trucks").select("*").eq("organization_id", orgId),
    supabase.from("delivery_slots").select("*").eq("organization_id", orgId),
    supabase.from("schedule_blocks").select("*").eq("organization_id", orgId).eq("block_date", order.delivery_date),
    supabase.from("delivery_slots").select("start_time").eq("id", order.slot_id).maybeSingle(),
    supabase
      .from("orders")
      .select("truck_id")
      .eq("organization_id", orgId)
      .eq("delivery_date", order.delivery_date)
      .in("status", ["confirmed", "ready"])
      .neq("assignment_source", "none")
      .neq("id", orderId),
  ]);

  if (zones.error || ranges.error || truckZones.error || trucks.error || slots.error || blocks.error || slotRow.error || loadRows.error) {
    return err("internal", "Failed to load assignment context");
  }

  const loads: Record<string, number> = {};
  for (const row of loadRows.data ?? []) {
    loads[row.truck_id] = (loads[row.truck_id] ?? 0) + 1;
  }

  const ctx: AssignmentContext = {
    zones: zones.data ?? [],
    ranges: (ranges.data ?? []) as ZonePostcodeRange[],
    truckZones: truckZones.data ?? [],
    trucks: (trucks.data ?? []) as DispatchTruck[],
    slots: slots.data ?? [],
    blocks: blocks.data ?? [],
    loads,
  };

  const suggestion = suggestTruck(
    {
      postcode: order.postcode,
      delivery_date: order.delivery_date,
      slot_start_time: slotRow.data?.start_time ?? null,
    },
    ctx,
  );
  if (!suggestion.ok) return ok({ assigned: false, reason: suggestion.reason });

  const { error: rpcError } = await supabase.rpc("dispatch_assign_order", {
    p_order: orderId,
    p_truck: suggestion.truckId,
    p_source: "auto",
  });
  if (rpcError) return mapRpcError(rpcError.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok({ assigned: true });
}

// ---------------------------------------------------------------------------
// Depart
// ---------------------------------------------------------------------------

const DepartInputSchema = z.object({
  truckId: z.string().uuid(),
  date: z.string().regex(DATE_REGEX),
});

export async function departTruck(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = DepartInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid depart input", "errors.logistics.dispatch.invalidDepartInput");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_depart_truck", {
    p_truck: parsed.data.truckId,
    p_date: parsed.data.date,
  });
  if (error) {
    if (error.message.includes("not_found")) {
      return err(
        "not_found",
        "No delivery run exists for this truck on this date.",
        "errors.logistics.dispatch.departNotFound",
      );
    }
    if (error.message.includes("invalid_transition")) {
      return err(
        "conflict",
        "This run cannot depart from its current status.",
        "errors.logistics.dispatch.departInvalidTransition",
      );
    }
    if (error.message.includes("not_loaded")) {
      return err(
        "conflict",
        "The truck is not fully loaded yet. The loading bay has to sign every stop off first.",
        "errors.drive.run.notLoaded",
      );
    }
    return mapRpcError(error.message);
  }

  revalidatePath(`/${organizationSlug}/dispatch`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Plan apply (auto-plan deck) + loading confirmation
// ---------------------------------------------------------------------------

const ApplyPlanSchema = z.object({
  assignments: z
    .array(z.object({ orderId: z.string().uuid(), truckId: z.string().uuid() }))
    .min(1)
    .max(200),
});

export async function applyPlan(
  organizationSlug: string,
  rawInput: unknown,
): Promise<
  ActionResult<{
    applied: number;
    failed: { orderId: string; message: string; messageKey?: string }[];
  }>
> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = ApplyPlanSchema.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid plan payload");

  const supabase = await createSupabaseServerClient();
  let applied = 0;
  const failed: { orderId: string; message: string; messageKey?: string }[] = [];
  // Sequential on purpose: dispatch_assign_order locks order + run rows;
  // firing 200 in parallel invites deadlocks the RPC then rejects.
  for (const a of parsed.data.assignments) {
    const { error } = await supabase.rpc("dispatch_assign_order", {
      p_order: a.orderId,
      p_truck: a.truckId,
      p_source: "auto",
    });
    if (error) {
      const mapped = mapRpcError(error.message) as { ok: false; message: string; messageKey?: string };
      failed.push({ orderId: a.orderId, message: mapped.message, messageKey: mapped.messageKey });
    } else {
      applied += 1;
    }
  }

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok({ applied, failed });
}

const SetLoadedSchema = z.object({
  orderId: z.string().uuid(),
  loaded: z.boolean(),
});

export async function setOrderLoaded(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<void>> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = SetLoadedSchema.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid input");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_set_loaded", {
    p_order: parsed.data.orderId,
    p_loaded: parsed.data.loaded,
  });
  if (error) return mapRpcError(error.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  revalidatePath(`/${organizationSlug}/loading`);
  return ok(undefined);
}
