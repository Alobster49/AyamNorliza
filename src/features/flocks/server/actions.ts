"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { randomUUID } from "node:crypto";

import { recordAudit } from "@/lib/audit/events";
import { can, type Capability, type Role } from "@/lib/auth/permissions";
import { PermissionError, UnauthenticatedError, requireOrgMember } from "@/lib/auth/require-user";
import { type AdminContext } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedDb } from "@/features/farm-structure/server/db";
import {
  ApproveFlockPlanInput,
  ApproveHouseReadinessInput,
  CloseFlockInput,
  CreateFlockPlanInput,
  RecordFlockMovementInput,
  RecordHarvestPlanInput,
  RecordPlacementInput,
} from "../schema";
import { FLOCK_EVENTS } from "../events";
import { getFlock } from "./queries";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; fieldErrors?: Record<string, string[]> };

export type ActionErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal";

function err<T = never>(
  code: ActionErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function ctxFor(userId: string): AdminContext {
  return { actorUserId: userId, correlationId: randomUUID() };
}

async function requireCapability(
  organizationId: string,
  capability: Capability,
): Promise<{ member: Awaited<ReturnType<typeof requireOrgMember>>; ctx: AdminContext }> {
  const member = await requireOrgMember(organizationId);
  if (!can(member.role as Role, capability)) {
    throw new PermissionError("Insufficient role for this flock lifecycle action");
  }
  return { member, ctx: ctxFor(member.user_id) };
}

function permissionErrorResult(error: unknown): ActionResult {
  if (error instanceof UnauthenticatedError) return err("unauthenticated", "Sign in first");
  if (error instanceof PermissionError) return err("forbidden", error.message);
  throw error;
}

export async function createFlockPlanAction(rawInput: unknown): Promise<ActionResult<{ flockId: string }>> {
  const parsed = CreateFlockPlanInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid flock plan input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "flock_lifecycle.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ flockId: string }>;
  }

  const db = untypedDb(await createSupabaseServerClient());
  const flockResult = await db
    .from("flocks")
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      house_id: input.houseId ?? null,
      production_profile_id: input.productionProfileId,
      target_profile_version_id: input.targetProfileVersionId ?? null,
      code: input.code,
      name: input.name,
      production_type: input.productionType,
      source_name: input.sourceName,
      breed_strain: input.breedStrain,
      sex: input.sex,
      hatch_date: input.hatchDate,
      planned_arrival_date: input.plannedArrivalDate,
      expected_end_date: input.expectedEndDate ?? null,
      planned_quantity: input.plannedQuantity,
      status: "draft",
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (flockResult.error) {
    return flockResult.error.code === "23505"
      ? err("conflict", "Flock code or open house assignment already exists")
      : err("internal", flockResult.error.message);
  }

  const planResult = await db.from("flock_plans").insert({
    organization_id: input.organizationId,
    site_id: input.siteId,
    house_id: input.houseId ?? null,
    flock_id: flockResult.data.id,
    plan_notes: input.planNotes ?? null,
    created_by: auth.member.user_id,
    updated_by: auth.member.user_id,
  });
  if (planResult.error) {
    await db.from("flocks").delete().eq("id", flockResult.data.id);
    return err("internal", planResult.error.message);
  }

  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FLOCK_EVENTS.planCreated,
    entityType: "flocks",
    entityId: flockResult.data.id,
    after: input,
  });
  revalidateFlocks(input.organizationId);
  return ok({ flockId: flockResult.data.id });
}

export async function approveFlockPlanAction(rawInput: unknown): Promise<ActionResult<{ flockId: string }>> {
  const parsed = ApproveFlockPlanInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid flock plan approval", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "flock_lifecycle.approve");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ flockId: string }>;
  }
  const flock = await requireFlockInOrg(input.flockId, input.organizationId);
  if (!flock.ok) return flock;
  if (flock.data.status !== "draft") return err("conflict", "Only draft flock plans can be approved");
  const db = untypedDb(await createSupabaseServerClient());
  const [planResult, flockResult] = await Promise.all([
    db
      .from("flock_plans")
      .update({
        approval_status: "approved",
        approved_by: auth.member.user_id,
        approved_at: new Date().toISOString(),
        approval_notes: input.approvalNotes,
        updated_by: auth.member.user_id,
      })
      .eq("flock_id", input.flockId),
    db.from("flocks").update({ status: "planned", updated_by: auth.member.user_id }).eq("id", input.flockId),
  ]);
  if (planResult.error) return err("internal", planResult.error.message);
  if (flockResult.error) return err("internal", flockResult.error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FLOCK_EVENTS.planApproved,
    entityType: "flocks",
    entityId: input.flockId,
    before: flock.data,
    after: { status: "planned" },
    reason: input.approvalNotes,
  });
  revalidateFlocks(input.organizationId);
  return ok({ flockId: input.flockId });
}

export async function approveHouseReadinessAction(rawInput: unknown): Promise<ActionResult<{ readinessReviewId: string }>> {
  const parsed = ApproveHouseReadinessInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid readiness input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "flock_lifecycle.approve");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ readinessReviewId: string }>;
  }
  const flock = await requireFlockInOrg(input.flockId, input.organizationId);
  if (!flock.ok) return flock;
  if (!flock.data.houseId) return err("conflict", "Assign a house before readiness approval");
  const db = untypedDb(await createSupabaseServerClient());
  if (flock.data.status === "planned") {
    const pending = await db.from("flocks").update({ status: "readiness_pending", updated_by: auth.member.user_id }).eq("id", input.flockId);
    if (pending.error) return err("internal", pending.error.message);
  }
  const review = await db
    .from("house_readiness_reviews")
    .insert({
      organization_id: input.organizationId,
      site_id: flock.data.siteId,
      house_id: flock.data.houseId,
      flock_id: input.flockId,
      checklist_version: input.checklistVersion,
      results: input.results,
      approved_by: auth.member.user_id,
      approver_notes: input.approverNotes,
    })
    .select("id")
    .single();
  if (review.error) return err("internal", review.error.message);
  const ready = await db.from("flocks").update({ status: "ready", updated_by: auth.member.user_id }).eq("id", input.flockId);
  if (ready.error) return err("internal", ready.error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FLOCK_EVENTS.houseReady,
    entityType: "house_readiness_reviews",
    entityId: review.data.id,
    after: input,
    reason: input.approverNotes,
  });
  revalidateFlocks(input.organizationId);
  return ok({ readinessReviewId: review.data.id });
}

export async function recordPlacementAction(rawInput: unknown): Promise<ActionResult<{ placementId: string }>> {
  const parsed = RecordPlacementInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid placement input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "flock_lifecycle.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ placementId: string }>;
  }
  const flock = await requireFlockInOrg(input.flockId, input.organizationId);
  if (!flock.ok) return flock;
  if (flock.data.status !== "ready") return err("conflict", "Flock must be ready before placement");
  if (!flock.data.houseId) return err("conflict", "Flock needs an assigned house before placement");
  const db = untypedDb(await createSupabaseServerClient());
  const placement = await db
    .from("placements")
    .insert({
      organization_id: input.organizationId,
      site_id: flock.data.siteId,
      house_id: flock.data.houseId,
      flock_id: input.flockId,
      placement_time: input.placementTime,
      actual_quantity: input.actualQuantity,
      doa_quantity: input.doaQuantity,
      vehicle_reference: input.vehicleReference ?? null,
      supplier_reference: input.supplierReference ?? null,
      initial_observations: input.initialObservations ?? null,
      accepted_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (placement.error) return placement.error.code === "23505" ? err("conflict", "Placement already recorded") : err("internal", placement.error.message);
  const now = new Date().toISOString();
  const txRows = [
    {
      organization_id: input.organizationId,
      site_id: flock.data.siteId,
      house_id: flock.data.houseId,
      flock_id: input.flockId,
      transaction_type: "placement",
      quantity: input.actualQuantity,
      occurred_at: input.placementTime,
      source_table: "placements",
      source_id: placement.data.id,
      approval_status: "approved",
      approved_by: auth.member.user_id,
      approved_at: now,
      created_by: auth.member.user_id,
    },
  ];
  if (input.doaQuantity > 0) {
    txRows.push({
      ...txRows[0],
      transaction_type: "mortality",
      quantity: input.doaQuantity,
      reason: "Dead on arrival",
    } as any);
  }
  const tx = await db.from("flock_count_transactions").insert(txRows);
  if (tx.error) return err("internal", tx.error.message);
  const liveBirds = input.actualQuantity - input.doaQuantity;
  const update = await db
    .from("flocks")
    .update({ status: "active", current_live_birds: liveBirds, updated_by: auth.member.user_id })
    .eq("id", input.flockId);
  if (update.error) return err("internal", update.error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FLOCK_EVENTS.placed,
    entityType: "placements",
    entityId: placement.data.id,
    after: { ...input, liveBirds },
  });
  revalidateFlocks(input.organizationId);
  return ok({ placementId: placement.data.id });
}

export async function recordFlockMovementAction(rawInput: unknown): Promise<ActionResult<{ movementId: string }>> {
  const parsed = RecordFlockMovementInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid movement input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "flock_lifecycle.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ movementId: string }>;
  }
  const flock = await requireFlockInOrg(input.sourceFlockId, input.organizationId);
  if (!flock.ok) return flock;
  const db = untypedDb(await createSupabaseServerClient());
  const movement = await db
    .from("flock_movements")
    .insert({
      organization_id: input.organizationId,
      site_id: flock.data.siteId,
      source_house_id: flock.data.houseId,
      destination_house_id: input.destinationHouseId ?? null,
      source_flock_id: input.sourceFlockId,
      destination_flock_id: input.destinationFlockId ?? null,
      movement_type: input.movementType,
      quantity: input.quantity,
      reason: input.reason,
      approval_status: "approved",
      approved_by: auth.member.user_id,
      approved_at: new Date().toISOString(),
      lineage: { sourceFlockId: input.sourceFlockId, destinationFlockId: input.destinationFlockId ?? null },
      created_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (movement.error) return err("internal", movement.error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FLOCK_EVENTS.moved,
    entityType: "flock_movements",
    entityId: movement.data.id,
    after: input,
    reason: input.reason,
  });
  revalidateFlocks(input.organizationId);
  return ok({ movementId: movement.data.id });
}

export async function recordHarvestPlanAction(rawInput: unknown): Promise<ActionResult<{ harvestPlanId: string }>> {
  const parsed = RecordHarvestPlanInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid harvest plan input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "flock_lifecycle.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ harvestPlanId: string }>;
  }
  const flock = await requireFlockInOrg(input.flockId, input.organizationId);
  if (!flock.ok) return flock;
  const db = untypedDb(await createSupabaseServerClient());
  const harvest = await db
    .from("harvest_plans")
    .insert({
      organization_id: input.organizationId,
      site_id: flock.data.siteId,
      house_id: flock.data.houseId,
      flock_id: input.flockId,
      planned_date: input.plannedDate,
      destination: input.destination,
      expected_quantity: input.expectedQuantity,
      expected_weight_kg: input.expectedWeightKg ?? null,
      crew_notes: input.crewNotes ?? null,
      vehicle_reference: input.vehicleReference ?? null,
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (harvest.error) return err("internal", harvest.error.message);
  const update = await db.from("flocks").update({ status: "harvest_pending", updated_by: auth.member.user_id }).eq("id", input.flockId);
  if (update.error) return err("internal", update.error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FLOCK_EVENTS.harvestStarted,
    entityType: "harvest_plans",
    entityId: harvest.data.id,
    after: input,
  });
  revalidateFlocks(input.organizationId);
  return ok({ harvestPlanId: harvest.data.id });
}

export async function closeFlockAction(rawInput: unknown): Promise<ActionResult<{ closeoutId: string }>> {
  const parsed = CloseFlockInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid closeout input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "flock_lifecycle.close");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ closeoutId: string }>;
  }
  const flock = await requireFlockInOrg(input.flockId, input.organizationId);
  if (!flock.ok) return flock;
  if (!["depopulated", "closing"].includes(flock.data.status)) return err("conflict", "Flock must be depopulated before closeout");
  const db = untypedDb(await createSupabaseServerClient());
  if (flock.data.status === "depopulated") {
    const closing = await db.from("flocks").update({ status: "closing", updated_by: auth.member.user_id }).eq("id", input.flockId);
    if (closing.error) return err("internal", closing.error.message);
  }
  const closeout = await db
    .from("flock_closeouts")
    .insert({
      organization_id: input.organizationId,
      site_id: flock.data.siteId,
      house_id: flock.data.houseId,
      flock_id: input.flockId,
      final_live_birds: input.finalLiveBirds,
      reconciliation: input.reconciliation,
      approval_notes: input.approvalNotes,
      approved_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (closeout.error) return closeout.error.code === "23505" ? err("conflict", "Flock already closed") : err("internal", closeout.error.message);
  const closed = await db
    .from("flocks")
    .update({
      status: "closed",
      current_live_birds: input.finalLiveBirds,
      closed_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .eq("id", input.flockId);
  if (closed.error) return err("internal", closed.error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FLOCK_EVENTS.closed,
    entityType: "flock_closeouts",
    entityId: closeout.data.id,
    after: input,
    reason: input.approvalNotes,
  });
  revalidateFlocks(input.organizationId);
  return ok({ closeoutId: closeout.data.id });
}

async function requireFlockInOrg(flockId: string, organizationId: string): Promise<ActionResult<NonNullable<Awaited<ReturnType<typeof getFlock>>>>> {
  const flock = await getFlock(flockId);
  if (!flock) return err("not_found", "Flock not found");
  if (flock.organizationId !== organizationId) return err("forbidden", "Flock is outside this organization");
  return ok(flock);
}

async function audit(
  auth: { member: Awaited<ReturnType<typeof requireOrgMember>>; ctx: AdminContext },
  args: {
    organizationId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
) {
  await recordAudit(
    {
      organizationId: args.organizationId,
      actorUserId: auth.member.user_id,
      actorRole: auth.member.role,
      eventType: args.eventType,
      entityType: args.entityType,
      entityId: args.entityId,
      before: args.before,
      after: args.after,
      reason: args.reason,
      correlationId: auth.ctx.correlationId,
      source: "web",
    },
    auth.ctx,
  );
}

function revalidateFlocks(organizationId: string) {
  revalidateTag(`flocks:${organizationId}`, "max");
  revalidatePath(`/[organizationSlug]/flocks`, "page");
  revalidatePath(`/[organizationSlug]/overview`, "page");
}
