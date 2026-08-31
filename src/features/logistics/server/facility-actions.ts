"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import type { PermissionAction } from "@/lib/auth/rbac";
import type { ActionResult } from "@/features/orders/types";
import {
  BayInputSchema,
  FacilityInputSchema,
  PostcodeRangeInputSchema,
  type Bay,
  type Facility,
  type ZonePostcodeRange,
} from "../types";

type LogisticsErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(
  code: LogisticsErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function guardPermission(
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
// Logistics setup (read: facility + bays + postcode ranges)
// ---------------------------------------------------------------------------

export type LogisticsSetup = {
  facility: Facility | null;
  bays: Bay[];
  ranges: ZonePostcodeRange[];
};

export async function getLogisticsSetup(
  organizationSlug: string,
): Promise<ActionResult<LogisticsSetup>> {
  const guard = await guardPermission(organizationSlug, "delivery_setup", "view");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const [facility, bays, ranges] = await Promise.all([
    supabase
      .from("facilities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("bays").select("*").eq("organization_id", orgId).order("position", { ascending: true }),
    supabase.from("zone_postcode_ranges").select("*").eq("organization_id", orgId).order("postcode_start", { ascending: true }),
  ]);

  if (facility.error || bays.error || ranges.error) {
    return err("internal", "Failed to load logistics setup");
  }

  return ok({
    facility: (facility.data ?? null) as Facility | null,
    bays: (bays.data ?? []) as Bay[],
    ranges: (ranges.data ?? []) as ZonePostcodeRange[],
  });
}

// ---------------------------------------------------------------------------
// Facility (owner/org_admin only)
// ---------------------------------------------------------------------------

export async function updateFacility(
  organizationSlug: string,
  facilityId: string,
  rawInput: unknown,
): Promise<ActionResult<Facility>> {
  const guard = await guardPermission(organizationSlug, "delivery_setup", "edit");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = FacilityInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid facility input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("facilities")
    .update({
      name: input.name,
      address_line: input.addressLine,
      postcode: input.postcode,
      state: input.state,
    })
    .eq("id", facilityId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to update facility");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Facility);
}

// ---------------------------------------------------------------------------
// Bays (managers)
// ---------------------------------------------------------------------------

export async function createBay(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<Bay>> {
  const guard = await guardPermission(organizationSlug, "delivery_runs", "add");
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = BayInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid bay input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  const { data: facility, error: facilityError } = await supabase
    .from("facilities")
    .select("id")
    .eq("id", input.facilityId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (facilityError) return err("internal", "Failed to create bay");
  if (!facility) return err("validation", "Unknown facility");

  const { data, error } = await supabase
    .from("bays")
    .insert({
      organization_id: orgId,
      facility_id: input.facilityId,
      name: input.name,
      position: input.position,
      is_active: input.isActive,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to create bay");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Bay);
}

export async function updateBay(
  organizationSlug: string,
  bayId: string,
  rawInput: unknown,
): Promise<ActionResult<Bay>> {
  const guard = await guardPermission(organizationSlug, "delivery_runs", "edit");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = BayInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid bay input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bays")
    .update({
      name: input.name,
      position: input.position,
      is_active: input.isActive,
    })
    .eq("id", bayId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to update bay");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Bay);
}

export async function deleteBay(
  organizationSlug: string,
  bayId: string,
): Promise<ActionResult> {
  const guard = await guardPermission(organizationSlug, "delivery_runs", "delete");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("bays")
    .delete()
    .eq("id", bayId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", "Failed to delete bay");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

export async function setTruckBay(
  organizationSlug: string,
  truckId: string,
  bayId: string | null,
): Promise<ActionResult> {
  const guard = await guardPermission(organizationSlug, "delivery_runs", "edit");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = z.string().uuid().nullable().safeParse(bayId);
  if (!parsed.success) {
    return err("validation", "Invalid bay selection");
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.data !== null) {
    const { data: bay, error: bayError } = await supabase
      .from("bays")
      .select("id")
      .eq("id", parsed.data)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (bayError) return err("internal", "Failed to update truck bay");
    if (!bay) return err("validation", "Unknown bay");
  }

  const { error } = await supabase
    .from("trucks")
    .update({ bay_id: parsed.data })
    .eq("id", truckId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", "Failed to update truck bay");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Zone postcode ranges (managers; insert/delete only)
// ---------------------------------------------------------------------------

export async function addPostcodeRange(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<ZonePostcodeRange>> {
  const guard = await guardPermission(organizationSlug, "delivery_runs", "add");
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = PostcodeRangeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid postcode range", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  const { data: zone, error: zoneError } = await supabase
    .from("delivery_zones")
    .select("id")
    .eq("id", input.zoneId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (zoneError) return err("internal", "Failed to add postcode range");
  if (!zone) return err("validation", "Unknown zone");

  const { data, error } = await supabase
    .from("zone_postcode_ranges")
    .insert({
      organization_id: orgId,
      zone_id: input.zoneId,
      postcode_start: input.postcodeStart,
      postcode_end: input.postcodeEnd,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", "Failed to add postcode range");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as ZonePostcodeRange);
}

export async function deletePostcodeRange(
  organizationSlug: string,
  rangeId: string,
): Promise<ActionResult> {
  const guard = await guardPermission(organizationSlug, "delivery_runs", "delete");
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("zone_postcode_ranges")
    .delete()
    .eq("id", rangeId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", "Failed to delete postcode range");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}
