"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { randomUUID } from "node:crypto";

import { recordAudit } from "@/lib/audit/events";
import { can, type Capability, type Role } from "@/lib/auth/permissions";
import { PermissionError, UnauthenticatedError, requireOrgMember } from "@/lib/auth/require-user";
import { type AdminContext } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedDb } from "@/features/farm-structure/server/db";
import { DAILY_OPERATIONS_EVENTS } from "../events";
import { flattenTemplateQuestions, getSyncOperationOutcome, validateInspectionCompletion } from "../domain";
import {
  ApproveCorrectionInput,
  ApproveInspectionTemplateVersionInput,
  ApprovePeriodCloseInput,
  AssignShiftInput,
  CreateHandoverInput,
  CreateInspectionTemplateVersionInput,
  CreateObservationInput,
  CreatePeriodCloseInput,
  CreateShiftInput,
  RequestCorrectionInput,
  StartInspectionInput,
  SubmitInspectionInput,
  SubmitSyncOperationsInput,
} from "../schema";
import { getTemplateVersion } from "./queries";

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

function err<T = never>(code: ActionErrorCode, message: string, fieldErrors?: Record<string, string[]>): ActionResult<T> {
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
    throw new PermissionError("Insufficient role for this daily-operations action");
  }
  return { member, ctx: ctxFor(member.user_id) };
}

function permissionErrorResult(error: unknown): ActionResult {
  if (error instanceof UnauthenticatedError) return err("unauthenticated", "Sign in first");
  if (error instanceof PermissionError) return err("forbidden", error.message);
  throw error;
}

export async function startInspectionAction(rawInput: unknown): Promise<ActionResult<{ inspectionId: string }>> {
  const parsed = StartInspectionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid inspection start", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ inspectionId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const inspectionId = input.inspectionId ?? randomUUID();
  const { data, error } = await db
    .from("inspections")
    .insert({
      id: inspectionId,
      organization_id: input.organizationId,
      site_id: input.siteId,
      house_id: input.houseId,
      flock_id: input.flockId ?? null,
      shift_id: input.shiftId ?? null,
      template_version_id: input.templateVersionId,
      status: "in_progress",
      started_at: input.startedAt,
      started_by: auth.member.user_id,
      client_operation_id: input.clientOperationId ?? null,
      sync_status: input.clientOperationId ? "synced" : "server",
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? err("conflict", "Inspection already exists for this client operation") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: DAILY_OPERATIONS_EVENTS.inspectionStarted,
    entityType: "inspections",
    entityId: data.id,
    after: input,
    clientOperationId: input.clientOperationId,
  });
  revalidateDaily(input.organizationId);
  return ok({ inspectionId: data.id });
}

export async function submitInspectionAction(rawInput: unknown): Promise<ActionResult<{ inspectionId: string }>> {
  const parsed = SubmitInspectionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid inspection submission", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ inspectionId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const inspectionResult = await db
    .from("inspections")
    .select("id, organization_id, site_id, house_id, flock_id, template_version_id, status")
    .eq("id", input.inspectionId)
    .maybeSingle();
  if (inspectionResult.error) return err("internal", inspectionResult.error.message);
  if (!inspectionResult.data || inspectionResult.data.organization_id !== input.organizationId) return err("not_found", "Inspection not found");
  if (inspectionResult.data.status === "locked") return err("conflict", "Locked inspections require a correction request");
  const template = await getTemplateVersion(inspectionResult.data.template_version_id);
  const completion = validateInspectionCompletion({
    questions: flattenTemplateQuestions(template?.definition),
    responses: input.responses,
  });
  if (!completion.ok) {
    return err("validation", "Complete required critical checks before signing", {
      responses: [...completion.missingRequired, ...completion.missingCriticalReasons],
    });
  }

  const responseRows = input.responses.map((response) => ({
    organization_id: input.organizationId,
    inspection_id: input.inspectionId,
    question_key: response.questionKey,
    label: response.label ?? null,
    response_type: response.responseType,
    value: response.value,
    unit: response.unit ?? null,
    status: response.status,
    exception_reason: response.exceptionReason ?? null,
    source: response.source,
    created_by: auth.member.user_id,
  }));
  const responsesResult = await db.from("inspection_responses").upsert(responseRows, { onConflict: "inspection_id,question_key" });
  if (responsesResult.error) return err("internal", responsesResult.error.message);

  if (input.observations.length > 0) {
    const observationsResult = await db.from("observations").insert(
      input.observations.map((observation) => ({
        organization_id: input.organizationId,
        inspection_id: input.inspectionId,
        site_id: observation.siteId,
        house_id: observation.houseId,
        flock_id: observation.flockId ?? null,
        category: observation.category,
        severity: observation.severity,
        description: observation.description,
        immediate_action: observation.immediateAction ?? null,
        follow_up_type: observation.followUpType ?? null,
        media: observation.media,
        created_by: auth.member.user_id,
      })),
    );
    if (observationsResult.error) return err("internal", observationsResult.error.message);
  }

  const update = await db
    .from("inspections")
    .update({
      status: "submitted",
      completed_at: input.completedAt,
      completed_by: auth.member.user_id,
      signature: input.signature,
      quality_score: Math.max(0, 100 - input.responses.filter((response) => response.status !== "ok").length * 10),
      sync_time: new Date().toISOString(),
      sync_status: "synced",
      updated_by: auth.member.user_id,
    })
    .eq("id", input.inspectionId);
  if (update.error) return err("internal", update.error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: DAILY_OPERATIONS_EVENTS.inspectionSubmitted,
    entityType: "inspections",
    entityId: input.inspectionId,
    after: input,
  });
  revalidateDaily(input.organizationId);
  return ok({ inspectionId: input.inspectionId });
}

export async function submitSyncOperationsAction(rawInput: unknown): Promise<ActionResult<{ results: Array<{ clientOperationId: string; result: string }> }>> {
  const parsed = SubmitSyncOperationsInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid sync operations", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ results: Array<{ clientOperationId: string; result: string }> }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const results: Array<{ clientOperationId: string; result: string }> = [];
  for (const operation of input.operations) {
    const existing = await db
      .from("sync_operations")
      .select("id, result")
      .eq("organization_id", input.organizationId)
      .eq("client_operation_id", operation.clientOperationId)
      .maybeSingle();
    if (existing.error) return err("internal", existing.error.message);
    const result = getSyncOperationOutcome({
      existingOperationId: existing.data?.id ?? null,
      locked: false,
      conflict: false,
    });
    if (!existing.data) {
      const insert = await db.from("sync_operations").insert({
        organization_id: input.organizationId,
        client_operation_id: operation.clientOperationId,
        entity_id: operation.entityId,
        entity_type: operation.entityType,
        mutation_type: operation.mutationType,
        local_event_time: operation.localEventTime,
        local_save_time: operation.localSaveTime,
        base_server_version: operation.baseServerVersion ?? null,
        payload_schema_version: operation.payloadSchemaVersion,
        payload: operation.payload,
        user_id: auth.member.user_id,
        attachment_references: operation.attachmentReferences,
        result,
      });
      if (insert.error) return err("internal", insert.error.message);
    }
    results.push({ clientOperationId: operation.clientOperationId, result });
  }
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: DAILY_OPERATIONS_EVENTS.syncOperationProcessed,
    entityType: "sync_operations",
    after: results,
  });
  revalidateDaily(input.organizationId);
  return ok({ results });
}

export async function createObservationAction(rawInput: unknown): Promise<ActionResult<{ observationId: string }>> {
  const parsed = CreateObservationInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid observation", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ observationId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db.from("observations").insert({
    organization_id: input.organizationId,
    inspection_id: input.inspectionId ?? null,
    site_id: input.siteId,
    house_id: input.houseId,
    flock_id: input.flockId ?? null,
    category: input.category,
    severity: input.severity,
    description: input.description,
    immediate_action: input.immediateAction ?? null,
    follow_up_type: input.followUpType ?? null,
    media: input.media,
    created_by: auth.member.user_id,
  }).select("id").single();
  if (error) return err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: DAILY_OPERATIONS_EVENTS.observationCreated,
    entityType: "observations",
    entityId: data.id,
    after: input,
  });
  revalidateDaily(input.organizationId);
  return ok({ observationId: data.id });
}

export async function createShiftAction(rawInput: unknown): Promise<ActionResult<{ shiftId: string }>> {
  const parsed = CreateShiftInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid shift", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.configure");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ shiftId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db.from("shifts").insert({
    organization_id: input.organizationId,
    site_id: input.siteId,
    name: input.name,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    role_requirements: input.roleRequirements,
    created_by: auth.member.user_id,
    updated_by: auth.member.user_id,
  }).select("id").single();
  if (error) return err("internal", error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.shiftCreated, entityType: "shifts", entityId: data.id, after: input });
  revalidateDaily(input.organizationId);
  return ok({ shiftId: data.id });
}

export async function assignShiftAction(rawInput: unknown): Promise<ActionResult<{ assignmentId: string }>> {
  const parsed = AssignShiftInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid assignment", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.configure");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ assignmentId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db.from("shift_assignments").insert({
    organization_id: input.organizationId,
    shift_id: input.shiftId,
    user_id: input.userId,
    site_id: input.siteId,
    house_id: input.houseId ?? null,
    responsibility: input.responsibility,
    created_by: auth.member.user_id,
  }).select("id").single();
  if (error) return err("internal", error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.shiftAssigned, entityType: "shift_assignments", entityId: data.id, after: input });
  revalidateDaily(input.organizationId);
  return ok({ assignmentId: data.id });
}

export async function createInspectionTemplateVersionAction(rawInput: unknown): Promise<ActionResult<{ templateVersionId: string }>> {
  const parsed = CreateInspectionTemplateVersionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid template version", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.configure");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ templateVersionId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  let templateId = input.templateId ?? null;
  if (!templateId) {
    const template = await db.from("inspection_templates").insert({
      organization_id: input.organizationId,
      name: input.name,
      status: "active",
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    }).select("id").single();
    if (template.error) return err("internal", template.error.message);
    templateId = template.data.id;
  }
  const version = await db.from("inspection_template_versions").insert({
    organization_id: input.organizationId,
    template_id: templateId,
    version: input.version,
    production_types: input.productionTypes,
    risk_classes: input.riskClasses,
    definition: input.definition,
    effective_from: input.effectiveFrom ?? null,
    effective_to: input.effectiveTo ?? null,
    created_by: auth.member.user_id,
    updated_by: auth.member.user_id,
  }).select("id").single();
  if (version.error) return version.error.code === "23505" ? err("conflict", "Template version already exists") : err("internal", version.error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.templateVersionCreated, entityType: "inspection_template_versions", entityId: version.data.id, after: input });
  revalidateDaily(input.organizationId);
  return ok({ templateVersionId: version.data.id });
}

export async function approveInspectionTemplateVersionAction(rawInput: unknown): Promise<ActionResult<{ templateVersionId: string }>> {
  const parsed = ApproveInspectionTemplateVersionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid template approval", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.configure");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ templateVersionId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const update = await db.from("inspection_template_versions").update({
    status: "approved",
    approved_by: auth.member.user_id,
    approved_at: new Date().toISOString(),
    approval_notes: input.approvalNotes,
    updated_by: auth.member.user_id,
  }).eq("id", input.templateVersionId).eq("organization_id", input.organizationId);
  if (update.error) return err("internal", update.error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.templateVersionApproved, entityType: "inspection_template_versions", entityId: input.templateVersionId, reason: input.approvalNotes });
  revalidateDaily(input.organizationId);
  return ok({ templateVersionId: input.templateVersionId });
}

export async function createHandoverAction(rawInput: unknown): Promise<ActionResult<{ handoverId: string }>> {
  const parsed = CreateHandoverInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid handover", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.record");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ handoverId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db.from("handovers").insert({
    organization_id: input.organizationId,
    site_id: input.siteId,
    from_shift_id: input.fromShiftId,
    to_shift_id: input.toShiftId,
    unresolved_items: input.unresolvedItems,
    restrictions: input.restrictions,
    equipment_state: input.equipmentState,
    next_actions: input.nextActions,
    acknowledgement_notes: input.acknowledgementNotes ?? null,
    acknowledged_by: auth.member.user_id,
    acknowledged_at: new Date().toISOString(),
    created_by: auth.member.user_id,
  }).select("id").single();
  if (error) return err("internal", error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.handoverCreated, entityType: "handovers", entityId: data.id, after: input });
  revalidateDaily(input.organizationId);
  return ok({ handoverId: data.id });
}

export async function createPeriodCloseAction(rawInput: unknown): Promise<ActionResult<{ periodCloseId: string }>> {
  const parsed = CreatePeriodCloseInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid period close", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.close");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ periodCloseId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db.from("period_closes").insert({
    organization_id: input.organizationId,
    site_id: input.siteId,
    house_id: input.houseId ?? null,
    period_type: input.periodType,
    operating_date: input.operatingDate ?? null,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    completeness: input.completeness,
    status: "ready",
    reviewer_notes: input.reviewerNotes ?? null,
    reviewed_by: auth.member.user_id,
    created_by: auth.member.user_id,
    updated_by: auth.member.user_id,
  }).select("id").single();
  if (error) return error.code === "23505" ? err("conflict", "Period close already exists") : err("internal", error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.periodCloseCreated, entityType: "period_closes", entityId: data.id, after: input });
  revalidateDaily(input.organizationId);
  return ok({ periodCloseId: data.id });
}

export async function approvePeriodCloseAction(rawInput: unknown): Promise<ActionResult<{ periodCloseId: string }>> {
  const parsed = ApprovePeriodCloseInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid period close approval", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.close");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ periodCloseId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const update = await db.from("period_closes").update({
    status: "locked",
    approved_by: auth.member.user_id,
    approved_at: new Date().toISOString(),
    locked_at: new Date().toISOString(),
    reviewer_notes: input.approvalNotes,
    updated_by: auth.member.user_id,
  }).eq("id", input.periodCloseId).eq("organization_id", input.organizationId);
  if (update.error) return err("internal", update.error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.periodCloseApproved, entityType: "period_closes", entityId: input.periodCloseId, reason: input.approvalNotes });
  revalidateDaily(input.organizationId);
  return ok({ periodCloseId: input.periodCloseId });
}

export async function requestCorrectionAction(rawInput: unknown): Promise<ActionResult<{ correctionId: string }>> {
  const parsed = RequestCorrectionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid correction", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.correct");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ correctionId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db.from("record_corrections").insert({
    organization_id: input.organizationId,
    target_table: input.targetTable,
    target_record_id: input.targetRecordId,
    before_value: input.beforeValue,
    after_value: input.afterValue,
    reason: input.reason,
    risk_level: input.riskLevel,
    requested_by: auth.member.user_id,
  }).select("id").single();
  if (error) return err("internal", error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.correctionRequested, entityType: "record_corrections", entityId: data.id, after: input, reason: input.reason });
  revalidateDaily(input.organizationId);
  return ok({ correctionId: data.id });
}

export async function approveCorrectionAction(rawInput: unknown): Promise<ActionResult<{ correctionId: string }>> {
  const parsed = ApproveCorrectionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid correction decision", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "daily_operations.correct");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ correctionId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const update = await db.from("record_corrections").update({
    status: input.decision,
    decided_by: auth.member.user_id,
    decided_at: new Date().toISOString(),
    reviewer_reason: input.reviewerReason,
  }).eq("id", input.correctionId).eq("organization_id", input.organizationId);
  if (update.error) return err("internal", update.error.message);
  await audit(auth, { organizationId: input.organizationId, eventType: DAILY_OPERATIONS_EVENTS.correctionDecided, entityType: "record_corrections", entityId: input.correctionId, reason: input.reviewerReason, after: { decision: input.decision } });
  revalidateDaily(input.organizationId);
  return ok({ correctionId: input.correctionId });
}

async function audit(
  auth: { member: Awaited<ReturnType<typeof requireOrgMember>>; ctx: AdminContext },
  args: {
    organizationId: string;
    eventType: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    clientOperationId?: string | null;
  },
) {
  await recordAudit(
    {
      organizationId: args.organizationId,
      actorUserId: auth.member.user_id,
      actorRole: auth.member.role,
      eventType: args.eventType,
      entityType: args.entityType,
      entityId: args.entityId ?? null,
      before: args.before ?? null,
      after: args.after ?? null,
      reason: args.reason ?? null,
      clientOperationId: args.clientOperationId ?? null,
      source: "web",
    },
    auth.ctx,
  );
}

function revalidateDaily(organizationId: string) {
  revalidateTag(`daily-operations:${organizationId}`, "max");
  revalidatePath("/");
}
