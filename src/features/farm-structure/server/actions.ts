"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { randomUUID } from "node:crypto";

import { recordAudit } from "@/lib/audit/events";
import { can, type Capability, type Role } from "@/lib/auth/permissions";
import { PermissionError, UnauthenticatedError, requireOrgMember } from "@/lib/auth/require-user";
import { type AdminContext } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ApproveTargetProfileVersionInput,
  CreateHouseAreaInput,
  CreateHouseInput,
  CreateSiteInput,
  CreateStorageLocationInput,
  CreateTargetProfileVersionInput,
  CreateZoneInput,
  GenerateIdentifierInput,
  UpsertCodeSetInput,
  UpsertCodeValueInput,
  UpsertProductionProfileInput,
  UpsertTargetProfileInput,
} from "../schema";
import {
  formatLabelCode,
  hashTargetProfileDefinition,
  validateTargetCurvePoints,
} from "../domain";
import { FARM_STRUCTURE_EVENTS } from "../events";
import { getTargetProfileVersion } from "./queries";
import { untypedDb } from "./db";

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
    throw new PermissionError("Insufficient role for this farm-structure action");
  }
  return { member, ctx: ctxFor(member.user_id) };
}

function permissionErrorResult(error: unknown): ActionResult {
  if (error instanceof UnauthenticatedError) return err("unauthenticated", "Sign in first");
  if (error instanceof PermissionError) return err("forbidden", error.message);
  throw error;
}

export async function createSiteAction(rawInput: unknown): Promise<ActionResult<{ siteId: string }>> {
  const parsed = CreateSiteInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid site input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "farm_structure.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ siteId: string }>;
  }

  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("sites")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      code: input.code,
      legal_name: input.legalName ?? null,
      address: input.address ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      time_zone: input.timeZone,
      default_unit_system: input.defaultUnitSystem,
      currency_code: input.currencyCode,
      contacts: input.contacts,
      biosecurity_layout: input.biosecurityLayout,
      status: input.status,
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? err("conflict", "Site code already exists") : err("internal", error.message);

  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.siteCreated,
    entityType: "sites",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ siteId: data.id });
}

export async function createZoneAction(rawInput: unknown): Promise<ActionResult<{ zoneId: string }>> {
  const parsed = CreateZoneInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid zone input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "farm_structure.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ zoneId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("biosecurity_zones")
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      parent_zone_id: input.parentZoneId ?? null,
      name: input.name,
      code: input.code,
      risk_class: input.riskClass,
      entry_rules: input.entryRules,
      status: input.status,
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? err("conflict", "Zone code already exists for this site") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.zoneCreated,
    entityType: "biosecurity_zones",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ zoneId: data.id });
}

export async function createHouseAction(rawInput: unknown): Promise<ActionResult<{ houseId: string }>> {
  const parsed = CreateHouseInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid house input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "farm_structure.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ houseId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("houses")
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      zone_id: input.zoneId ?? null,
      code: input.code,
      name: input.name,
      capacity_birds: input.capacityBirds,
      length_meters: input.lengthMeters ?? null,
      width_meters: input.widthMeters ?? null,
      height_meters: input.heightMeters ?? null,
      housing_system: input.housingSystem,
      production_purpose: input.productionPurpose,
      operational_status: input.operationalStatus,
      criticality: input.criticality,
      coordinates: input.coordinates,
      floor_plan: input.floorPlan,
      equipment: input.equipment,
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? err("conflict", "House code already exists for this site") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.houseCreated,
    entityType: "houses",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ houseId: data.id });
}

export async function createHouseAreaAction(rawInput: unknown): Promise<ActionResult<{ houseAreaId: string }>> {
  const parsed = CreateHouseAreaInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid house area input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "farm_structure.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ houseAreaId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const house = await db.from("houses").select("site_id").eq("id", input.houseId).maybeSingle();
  if (house.error) return err("internal", house.error.message);
  if (!house.data) return err("not_found", "House not found");
  const { data, error } = await db
    .from("house_areas")
    .insert({
      organization_id: input.organizationId,
      site_id: house.data.site_id,
      house_id: input.houseId,
      code: input.code,
      name: input.name,
      area_type: input.areaType,
      capacity_birds: input.capacityBirds ?? null,
      sequence: input.sequence,
      geometry: input.geometry,
      status: input.status,
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? err("conflict", "House area code already exists") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.houseAreaCreated,
    entityType: "house_areas",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ houseAreaId: data.id });
}

export async function createStorageLocationAction(
  rawInput: unknown,
): Promise<ActionResult<{ storageLocationId: string }>> {
  const parsed = CreateStorageLocationInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid storage location input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "farm_structure.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ storageLocationId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("storage_locations")
    .insert({
      organization_id: input.organizationId,
      site_id: input.siteId,
      zone_id: input.zoneId ?? null,
      code: input.code,
      name: input.name,
      location_type: input.locationType,
      conditions: input.conditions,
      restricted: input.restricted,
      status: input.status,
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? err("conflict", "Storage location code already exists") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.storageLocationCreated,
    entityType: "storage_locations",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ storageLocationId: data.id });
}

export async function upsertProductionProfileAction(
  rawInput: unknown,
): Promise<ActionResult<{ productionProfileId: string }>> {
  const parsed = UpsertProductionProfileInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid production profile input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "master_data.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ productionProfileId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const payload = {
    organization_id: input.organizationId,
    type: input.type,
    name: input.name,
    workflow_options: input.workflowOptions,
    owner_user_id: input.ownerUserId ?? null,
    status: input.status,
    updated_by: auth.member.user_id,
  };
  const query = input.profileId
    ? db.from("production_profiles").update(payload).eq("id", input.profileId).select("id").single()
    : db.from("production_profiles").insert({ ...payload, created_by: auth.member.user_id }).select("id").single();
  const { data, error } = await query;
  if (error) return error.code === "23505" ? err("conflict", "Production profile already exists") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.productionProfileChanged,
    entityType: "production_profiles",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ productionProfileId: data.id });
}

export async function upsertTargetProfileAction(rawInput: unknown): Promise<ActionResult<{ targetProfileId: string }>> {
  const parsed = UpsertTargetProfileInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid target profile input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "target_profile.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ targetProfileId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const payload = {
    organization_id: input.organizationId,
    profile_family: input.profileFamily,
    production_type: input.productionType,
    breed_strain: input.breedStrain,
    housing_system: input.housingSystem ?? null,
    region: input.region ?? null,
    owner_user_id: input.ownerUserId ?? null,
    status: input.status,
    updated_by: auth.member.user_id,
  };
  const query = input.targetProfileId
    ? db.from("target_profiles").update(payload).eq("id", input.targetProfileId).select("id").single()
    : db.from("target_profiles").insert({ ...payload, created_by: auth.member.user_id }).select("id").single();
  const { data, error } = await query;
  if (error) return error.code === "23505" ? err("conflict", "Target profile already exists") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.targetProfileChanged,
    entityType: "target_profiles",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ targetProfileId: data.id });
}

export async function createTargetProfileVersionAction(
  rawInput: unknown,
): Promise<ActionResult<{ targetProfileVersionId: string }>> {
  const parsed = CreateTargetProfileVersionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid target profile version input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  const curveValidation = validateTargetCurvePoints(input.points);
  if (!curveValidation.valid) return err("validation", curveValidation.errors.join("; "));
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "target_profile.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ targetProfileVersionId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const versionResult = await db
    .from("target_profile_versions")
    .insert({
      organization_id: input.organizationId,
      target_profile_id: input.targetProfileId,
      version: input.version,
      effective_from: input.effectiveFrom ?? null,
      effective_to: input.effectiveTo ?? null,
      source_document: input.sourceDocument ?? null,
      approval_notes: input.approvalNotes ?? null,
      status: input.status,
      definition: input.definition,
      created_by: auth.member.user_id,
      updated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (versionResult.error) {
    return versionResult.error.code === "23505"
      ? err("conflict", "Target profile version already exists")
      : err("internal", versionResult.error.message);
  }
  const pointRows = input.points.map((point) => ({
    organization_id: input.organizationId,
    target_profile_version_id: versionResult.data.id,
    metric: point.metric,
    age_start_day: point.ageStartDay,
    age_end_day: point.ageEndDay,
    stage: point.stage ?? null,
    target_value: point.targetValue,
    min_value: point.minValue ?? null,
    max_value: point.maxValue ?? null,
    unit: point.unit,
    interpolation_method: point.interpolationMethod,
  }));
  const pointResult = await db.from("target_curve_points").insert(pointRows);
  if (pointResult.error) {
    await db.from("target_profile_versions").delete().eq("id", versionResult.data.id);
    return err("internal", pointResult.error.message);
  }
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.targetProfileVersionCreated,
    entityType: "target_profile_versions",
    entityId: versionResult.data.id,
    after: { ...input, points: input.points.length },
  });
  revalidateStructure(input.organizationId);
  return ok({ targetProfileVersionId: versionResult.data.id });
}

export async function approveTargetProfileVersionAction(
  rawInput: unknown,
): Promise<ActionResult<{ targetProfileVersionId: string; definitionHash: string }>> {
  const parsed = ApproveTargetProfileVersionInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid approval input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "target_profile.approve");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ targetProfileVersionId: string; definitionHash: string }>;
  }
  const existing = await getTargetProfileVersion(input.versionId);
  if (!existing.version) return err("not_found", "Target profile version not found");
  if (existing.version.organizationId !== input.organizationId) return err("forbidden", "Target profile version is outside this organization");
  if (!["draft", "pending_approval"].includes(existing.version.status)) {
    return err("conflict", "Only draft or pending target profile versions can be approved");
  }
  const curveValidation = validateTargetCurvePoints(existing.points);
  if (!curveValidation.valid) return err("validation", curveValidation.errors.join("; "));
  const definitionHash = hashTargetProfileDefinition({
    definition: existing.version.definition,
    points: existing.points.map(({ id: _id, organizationId: _org, targetProfileVersionId: _versionId, ...point }) => point),
  });
  const db = untypedDb(await createSupabaseServerClient());
  const { error } = await db
    .from("target_profile_versions")
    .update({
      status: "approved",
      effective_from: input.effectiveFrom,
      approval_notes: input.approvalNotes,
      approved_by: auth.member.user_id,
      approved_at: new Date().toISOString(),
      definition_hash: definitionHash,
      updated_by: auth.member.user_id,
    })
    .eq("id", input.versionId);
  if (error) return err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.targetProfileVersionApproved,
    entityType: "target_profile_versions",
    entityId: input.versionId,
    before: existing.version,
    after: { status: "approved", definitionHash, effectiveFrom: input.effectiveFrom },
    reason: input.approvalNotes,
  });
  revalidateStructure(input.organizationId);
  return ok({ targetProfileVersionId: input.versionId, definitionHash });
}

export async function upsertCodeSetAction(rawInput: unknown): Promise<ActionResult<{ codeSetId: string }>> {
  const parsed = UpsertCodeSetInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid code set input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "master_data.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ codeSetId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const payload = {
    organization_id: input.organizationId,
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    status: input.status,
    updated_by: auth.member.user_id,
  };
  const query = input.codeSetId
    ? db.from("code_sets").update(payload).eq("id", input.codeSetId).select("id").single()
    : db.from("code_sets").insert({ ...payload, created_by: auth.member.user_id }).select("id").single();
  const { data, error } = await query;
  if (error) return error.code === "23505" ? err("conflict", "Code set key already exists") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.codeSetChanged,
    entityType: "code_sets",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ codeSetId: data.id });
}

export async function upsertCodeValueAction(rawInput: unknown): Promise<ActionResult<{ codeValueId: string }>> {
  const parsed = UpsertCodeValueInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid code value input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "master_data.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ codeValueId: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const payload = {
    organization_id: input.organizationId,
    code_set_id: input.codeSetId,
    code: input.code,
    label: input.label,
    translations: input.translations,
    sort_order: input.sortOrder,
    status: input.status,
    effective_from: input.effectiveFrom ?? null,
    effective_to: input.effectiveTo ?? null,
    metadata: input.metadata,
    updated_by: auth.member.user_id,
  };
  const query = input.codeValueId
    ? db.from("code_values").update(payload).eq("id", input.codeValueId).select("id").single()
    : db.from("code_values").insert({ ...payload, created_by: auth.member.user_id }).select("id").single();
  const { data, error } = await query;
  if (error) return error.code === "23505" ? err("conflict", "Code value already exists in this set") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.codeValueChanged,
    entityType: "code_values",
    entityId: data.id,
    after: input,
  });
  revalidateStructure(input.organizationId);
  return ok({ codeValueId: data.id });
}

export async function generateIdentifierAction(rawInput: unknown): Promise<ActionResult<{ identifierId: string; printableCode: string }>> {
  const parsed = GenerateIdentifierInput.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid identifier input", parsed.error.flatten().fieldErrors);
  const input = parsed.data;
  let auth: Awaited<ReturnType<typeof requireCapability>>;
  try {
    auth = await requireCapability(input.organizationId, "label.manage");
  } catch (error) {
    return permissionErrorResult(error) as ActionResult<{ identifierId: string; printableCode: string }>;
  }
  const db = untypedDb(await createSupabaseServerClient());
  const orgResult = await db.from("organizations").select("slug").eq("id", input.organizationId).single();
  if (orgResult.error) return err("internal", orgResult.error.message);
  const printableCode = formatLabelCode({
    organizationSlug: orgResult.data.slug,
    entityType: input.entityType,
    entityCode: input.entityCode,
    entityId: input.entityId,
  });
  const { data, error } = await db
    .from("qr_identifiers")
    .insert({
      organization_id: input.organizationId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      printable_code: printableCode,
      symbology: input.symbology,
      generated_by: auth.member.user_id,
    })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? err("conflict", "An active label already exists for this entity") : err("internal", error.message);
  await audit(auth, {
    organizationId: input.organizationId,
    eventType: FARM_STRUCTURE_EVENTS.identifierGenerated,
    entityType: "qr_identifiers",
    entityId: data.id,
    after: { ...input, printableCode },
  });
  revalidateStructure(input.organizationId);
  return ok({ identifierId: data.id, printableCode });
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

function revalidateStructure(organizationId: string) {
  revalidateTag(`farm-structure:${organizationId}`, "max");
  revalidatePath(`/[organizationSlug]/settings/sites`, "page");
  revalidatePath(`/[organizationSlug]/settings/zones`, "page");
  revalidatePath(`/[organizationSlug]/settings/storage-locations`, "page");
  revalidatePath(`/[organizationSlug]/settings/production-profiles`, "page");
  revalidatePath(`/[organizationSlug]/settings/target-profiles`, "page");
  revalidatePath(`/[organizationSlug]/settings/master-data`, "page");
  revalidatePath(`/[organizationSlug]/settings/labels`, "page");
}
