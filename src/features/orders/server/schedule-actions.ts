"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderPermissionError } from "./guards";
import { requirePermission } from "@/lib/auth/require-permission";
import type { PermissionAction } from "@/lib/auth/rbac";
import {
  ZoneInputSchema,
  TruckInputSchema,
  SlotInputSchema,
  BlockInputSchema,
  type ActionResult,
  type DeliveryZone,
  type Truck,
  type DeliverySlot,
  type ScheduleBlock,
  type DeliverySetup,
} from "../types";

type ScheduleErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(
  code: ScheduleErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function guardManager(
  organizationSlug: string,
  resource: string,
  action: PermissionAction,
): Promise<
  | { ok: true; orgId: string; userId: string }
  | { ok: false; code: "forbidden"; message: string }
> {
  try {
    const ctx = await requirePermission(organizationSlug, resource, action);
    return { ok: true, orgId: ctx.orgId, userId: ctx.userId };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, code: "forbidden", message: e.message };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Delivery setup (read)
// ---------------------------------------------------------------------------

export async function getDeliverySetup(
  organizationSlug: string,
): Promise<ActionResult<DeliverySetup>> {
  const guard = await guardManager(organizationSlug, "delivery_setup", "view");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();

  const [zones, trucks, truckZones, slots, blocks] = await Promise.all([
    supabase
      .from("delivery_zones")
      .select("*")
      .eq("organization_id", orgId)
      .order("display_order", { ascending: true }),
    supabase.from("trucks").select("*").eq("organization_id", orgId).order("name", { ascending: true }),
    supabase.from("truck_zones").select("*").eq("organization_id", orgId),
    supabase
      .from("delivery_slots")
      .select("*")
      .eq("organization_id", orgId)
      .order("weekday", { ascending: true }),
    supabase
      .from("schedule_blocks")
      .select("*")
      .eq("organization_id", orgId)
      .order("block_date", { ascending: true }),
  ]);

  if (zones.error || trucks.error || truckZones.error || slots.error || blocks.error) {
    return err("internal", "Failed to load delivery setup");
  }

  return ok({
    zones: (zones.data ?? []) as DeliverySetup["zones"],
    trucks: (trucks.data ?? []) as DeliverySetup["trucks"],
    truckZones: (truckZones.data ?? []) as DeliverySetup["truckZones"],
    slots: (slots.data ?? []) as DeliverySetup["slots"],
    blocks: (blocks.data ?? []) as DeliverySetup["blocks"],
  });
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export async function createZone(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<DeliveryZone>> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "add");
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = ZoneInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid zone input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_zones")
    .insert({
      organization_id: orgId,
      name: input.name,
      display_order: input.displayOrder,
      is_active: input.isActive,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to create zone");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliveryZone);
}

export async function updateZone(
  organizationSlug: string,
  zoneId: string,
  rawInput: unknown,
): Promise<ActionResult<DeliveryZone>> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "edit");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = ZoneInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid zone input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_zones")
    .update({
      name: input.name,
      display_order: input.displayOrder,
      is_active: input.isActive,
    })
    .eq("id", zoneId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to update zone");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliveryZone);
}

export async function deleteZone(
  organizationSlug: string,
  zoneId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "delete");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("delivery_zones")
    .delete()
    .eq("id", zoneId)
    .eq("organization_id", orgId);

  if (error) {
    if (error.code === "23503") {
      return err("conflict", "This zone has orders using it. Remove or reassign those first.");
    }
    return err("internal", "Failed to delete zone");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Trucks
// ---------------------------------------------------------------------------

export async function createTruck(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<Truck>> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "add");
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = TruckInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid truck input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trucks")
    .insert({
      organization_id: orgId,
      name: input.name,
      code: input.code,
      is_active: input.isActive,
      capacity_kg: input.capacityKg,
      bay_id: input.bayId,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return err("conflict", "That truck code is already in use.");
    }
    return err("internal", "Failed to create truck");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Truck);
}

export async function updateTruck(
  organizationSlug: string,
  truckId: string,
  rawInput: unknown,
): Promise<ActionResult<Truck>> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "edit");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = TruckInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid truck input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trucks")
    .update({
      name: input.name,
      code: input.code,
      is_active: input.isActive,
      capacity_kg: input.capacityKg,
      bay_id: input.bayId,
    })
    .eq("id", truckId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return err("conflict", "That truck code is already in use.");
    }
    return err("internal", "Failed to update truck");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Truck);
}

export async function deleteTruck(
  organizationSlug: string,
  truckId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "delete");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trucks")
    .delete()
    .eq("id", truckId)
    .eq("organization_id", orgId);

  if (error) {
    if (error.code === "23503") {
      return err("conflict", "This truck has delivery runs or orders attached. Remove those first.");
    }
    return err("internal", "Failed to delete truck");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

export async function setTruckZones(
  organizationSlug: string,
  truckId: string,
  zoneIds: string[],
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "edit");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = z.array(z.string().uuid()).safeParse(zoneIds);
  if (!parsed.success) {
    return err("validation", "Invalid zone selection");
  }

  const supabase = await createSupabaseServerClient();
  const { error: deleteError } = await supabase
    .from("truck_zones")
    .delete()
    .eq("truck_id", truckId)
    .eq("organization_id", orgId);
  if (deleteError) {
    return err("internal", "Failed to update truck zones");
  }

  if (parsed.data.length > 0) {
    const { error: insertError } = await supabase.from("truck_zones").insert(
      parsed.data.map((zoneId) => ({
        truck_id: truckId,
        zone_id: zoneId,
        organization_id: orgId,
      })),
    );
    if (insertError) {
      return err("internal", "Failed to update truck zones");
    }
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export async function createSlot(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<DeliverySlot>> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "add");
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = SlotInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid slot input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_slots")
    .insert({
      organization_id: orgId,
      truck_id: input.truckId,
      weekday: input.weekday,
      start_time: input.startTime,
      end_time: input.endTime,
      max_orders: input.maxOrders,
      is_active: input.isActive,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to create slot");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliverySlot);
}

export async function updateSlot(
  organizationSlug: string,
  slotId: string,
  rawInput: unknown,
): Promise<ActionResult<DeliverySlot>> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "edit");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = SlotInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid slot input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_slots")
    .update({
      truck_id: input.truckId,
      weekday: input.weekday,
      start_time: input.startTime,
      end_time: input.endTime,
      max_orders: input.maxOrders,
      is_active: input.isActive,
    })
    .eq("id", slotId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to update slot");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as DeliverySlot);
}

export async function deleteSlot(
  organizationSlug: string,
  slotId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "delete");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("delivery_slots")
    .delete()
    .eq("id", slotId)
    .eq("organization_id", orgId);

  if (error) {
    if (error.code === "23503") {
      return err("conflict", "This slot has orders booked against it. Remove those first.");
    }
    return err("internal", "Failed to delete slot");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Blocked dates
// ---------------------------------------------------------------------------

export async function createBlock(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<ScheduleBlock>> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "add");
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = BlockInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid block input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("schedule_blocks")
    .insert({
      organization_id: orgId,
      block_date: input.blockDate,
      truck_id: input.truckId,
      reason: input.reason ?? null,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return err("conflict", "That date is already blocked for this truck.");
    }
    return err("internal", "Failed to create block");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as ScheduleBlock);
}

export async function deleteBlock(
  organizationSlug: string,
  blockId: string,
): Promise<ActionResult> {
  const guard = await guardManager(organizationSlug, "delivery_runs", "delete");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("schedule_blocks")
    .delete()
    .eq("id", blockId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", "Failed to delete block");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}
