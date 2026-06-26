import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BiosecurityZone,
  CodeSet,
  CodeValue,
  House,
  HouseArea,
  ProductionProfile,
  QrIdentifier,
  Site,
  StorageLocation,
  TargetCurvePoint,
  TargetProfile,
  TargetProfileVersion,
} from "../types";
import { untypedDb } from "./db";

export async function listSites(organizationId: string): Promise<Site[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("sites")
    .select(
      "id, organization_id, name, code, legal_name, address, latitude, longitude, time_zone, default_unit_system, currency_code, contacts, biosecurity_layout, status, created_at, updated_at, version",
    )
    .eq("organization_id", organizationId)
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToSite);
}

export async function getSite(siteId: string): Promise<Site | null> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("sites")
    .select(
      "id, organization_id, name, code, legal_name, address, latitude, longitude, time_zone, default_unit_system, currency_code, contacts, biosecurity_layout, status, created_at, updated_at, version",
    )
    .eq("id", siteId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToSite(data) : null;
}

export async function listZones(organizationId: string, siteId?: string): Promise<BiosecurityZone[]> {
  const db = untypedDb(await createSupabaseServerClient());
  let query = db
    .from("biosecurity_zones")
    .select("id, organization_id, site_id, parent_zone_id, name, code, risk_class, entry_rules, status")
    .eq("organization_id", organizationId)
    .order("code", { ascending: true });
  if (siteId) query = query.eq("site_id", siteId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToZone);
}

export async function listHouses(organizationId: string, siteId?: string): Promise<House[]> {
  const db = untypedDb(await createSupabaseServerClient());
  let query = db
    .from("houses")
    .select(
      "id, organization_id, site_id, zone_id, code, name, capacity_birds, length_meters, width_meters, height_meters, housing_system, production_purpose, operational_status, criticality, coordinates, floor_plan, equipment",
    )
    .eq("organization_id", organizationId)
    .order("code", { ascending: true });
  if (siteId) query = query.eq("site_id", siteId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToHouse);
}

export async function getHouse(houseId: string): Promise<House | null> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("houses")
    .select(
      "id, organization_id, site_id, zone_id, code, name, capacity_birds, length_meters, width_meters, height_meters, housing_system, production_purpose, operational_status, criticality, coordinates, floor_plan, equipment",
    )
    .eq("id", houseId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToHouse(data) : null;
}

export async function listHouseAreas(organizationId: string, houseId?: string): Promise<HouseArea[]> {
  const db = untypedDb(await createSupabaseServerClient());
  let query = db
    .from("house_areas")
    .select("id, organization_id, site_id, house_id, code, name, area_type, capacity_birds, sequence, geometry, status")
    .eq("organization_id", organizationId)
    .order("sequence", { ascending: true });
  if (houseId) query = query.eq("house_id", houseId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToHouseArea);
}

export async function listStorageLocations(
  organizationId: string,
  siteId?: string,
): Promise<StorageLocation[]> {
  const db = untypedDb(await createSupabaseServerClient());
  let query = db
    .from("storage_locations")
    .select("id, organization_id, site_id, zone_id, code, name, location_type, conditions, restricted, status")
    .eq("organization_id", organizationId)
    .order("code", { ascending: true });
  if (siteId) query = query.eq("site_id", siteId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToStorageLocation);
}

export async function listProductionProfiles(organizationId: string): Promise<ProductionProfile[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("production_profiles")
    .select("id, organization_id, type, name, workflow_options, owner_user_id, status")
    .eq("organization_id", organizationId)
    .order("type", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToProductionProfile);
}

export async function listTargetProfiles(organizationId: string): Promise<TargetProfile[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("target_profiles")
    .select("id, organization_id, profile_family, production_type, breed_strain, housing_system, region, owner_user_id, status")
    .eq("organization_id", organizationId)
    .order("profile_family", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToTargetProfile);
}

export async function listTargetProfileVersions(
  organizationId: string,
  targetProfileId?: string,
): Promise<TargetProfileVersion[]> {
  const db = untypedDb(await createSupabaseServerClient());
  let query = db
    .from("target_profile_versions")
    .select(
      "id, organization_id, target_profile_id, version, effective_from, effective_to, source_document, approval_notes, approved_by, approved_at, status, definition, definition_hash",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (targetProfileId) query = query.eq("target_profile_id", targetProfileId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToTargetProfileVersion);
}

export async function getTargetProfileVersion(versionId: string): Promise<{
  version: TargetProfileVersion | null;
  points: TargetCurvePoint[];
}> {
  const db = untypedDb(await createSupabaseServerClient());
  const versionResult = await db
    .from("target_profile_versions")
    .select(
      "id, organization_id, target_profile_id, version, effective_from, effective_to, source_document, approval_notes, approved_by, approved_at, status, definition, definition_hash",
    )
    .eq("id", versionId)
    .maybeSingle();
  if (versionResult.error) throw versionResult.error;
  if (!versionResult.data) return { version: null, points: [] };
  const pointsResult = await db
    .from("target_curve_points")
    .select(
      "id, organization_id, target_profile_version_id, metric, age_start_day, age_end_day, stage, target_value, min_value, max_value, unit, interpolation_method",
    )
    .eq("target_profile_version_id", versionId)
    .order("metric", { ascending: true })
    .order("age_start_day", { ascending: true });
  if (pointsResult.error) throw pointsResult.error;
  return {
    version: rowToTargetProfileVersion(versionResult.data),
    points: (pointsResult.data ?? []).map(rowToTargetCurvePoint),
  };
}

export async function listCodeSetsWithValues(organizationId: string): Promise<CodeSet[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const setsResult = await db
    .from("code_sets")
    .select("id, organization_id, key, name, description, status")
    .eq("organization_id", organizationId)
    .order("key", { ascending: true });
  if (setsResult.error) throw setsResult.error;
  const valuesResult = await db
    .from("code_values")
    .select(
      "id, organization_id, code_set_id, code, label, translations, sort_order, status, effective_from, effective_to, metadata",
    )
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true });
  if (valuesResult.error) throw valuesResult.error;
  const values = (valuesResult.data ?? []).map(rowToCodeValue);
  return (setsResult.data ?? []).map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    values: values.filter((value: CodeValue) => value.codeSetId === row.id),
  }));
}

export async function listIdentifiers(organizationId: string): Promise<QrIdentifier[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("qr_identifiers")
    .select(
      "id, organization_id, entity_type, entity_id, printable_code, symbology, status, replaced_by, replacement_reason, generated_at, generated_by, retired_at",
    )
    .eq("organization_id", organizationId)
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToIdentifier);
}

export async function getIdentifierByCode(
  organizationId: string,
  printableCode: string,
): Promise<QrIdentifier | null> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("qr_identifiers")
    .select(
      "id, organization_id, entity_type, entity_id, printable_code, symbology, status, replaced_by, replacement_reason, generated_at, generated_by, retired_at",
    )
    .eq("organization_id", organizationId)
    .eq("printable_code", printableCode)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToIdentifier(data) : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>) : [];
}

function rowToSite(row: any): Site {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    code: row.code,
    legalName: row.legal_name,
    address: row.address,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    timeZone: row.time_zone,
    defaultUnitSystem: row.default_unit_system,
    currencyCode: row.currency_code,
    contacts: recordArray(row.contacts),
    biosecurityLayout: record(row.biosecurity_layout),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function rowToZone(row: any): BiosecurityZone {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    parentZoneId: row.parent_zone_id,
    name: row.name,
    code: row.code,
    riskClass: row.risk_class,
    entryRules: record(row.entry_rules),
    status: row.status,
  };
}

function rowToHouse(row: any): House {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    zoneId: row.zone_id,
    code: row.code,
    name: row.name,
    capacityBirds: row.capacity_birds,
    lengthMeters: row.length_meters == null ? null : Number(row.length_meters),
    widthMeters: row.width_meters == null ? null : Number(row.width_meters),
    heightMeters: row.height_meters == null ? null : Number(row.height_meters),
    housingSystem: row.housing_system,
    productionPurpose: row.production_purpose,
    operationalStatus: row.operational_status,
    criticality: row.criticality,
    coordinates: record(row.coordinates),
    floorPlan: record(row.floor_plan),
    equipment: recordArray(row.equipment),
  };
}

function rowToHouseArea(row: any): HouseArea {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    houseId: row.house_id,
    code: row.code,
    name: row.name,
    areaType: row.area_type,
    capacityBirds: row.capacity_birds,
    sequence: row.sequence,
    geometry: record(row.geometry),
    status: row.status,
  };
}

function rowToStorageLocation(row: any): StorageLocation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    zoneId: row.zone_id,
    code: row.code,
    name: row.name,
    locationType: row.location_type,
    conditions: record(row.conditions),
    restricted: row.restricted,
    status: row.status,
  };
}

function rowToProductionProfile(row: any): ProductionProfile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    name: row.name,
    workflowOptions: record(row.workflow_options),
    ownerUserId: row.owner_user_id,
    status: row.status,
  };
}

function rowToTargetProfile(row: any): TargetProfile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    profileFamily: row.profile_family,
    productionType: row.production_type,
    breedStrain: row.breed_strain,
    housingSystem: row.housing_system,
    region: row.region,
    ownerUserId: row.owner_user_id,
    status: row.status,
  };
}

function rowToTargetProfileVersion(row: any): TargetProfileVersion {
  return {
    id: row.id,
    organizationId: row.organization_id,
    targetProfileId: row.target_profile_id,
    version: row.version,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    sourceDocument: row.source_document,
    approvalNotes: row.approval_notes,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    status: row.status,
    definition: record(row.definition),
    definitionHash: row.definition_hash,
  };
}

function rowToTargetCurvePoint(row: any): TargetCurvePoint {
  return {
    id: row.id,
    organizationId: row.organization_id,
    targetProfileVersionId: row.target_profile_version_id,
    metric: row.metric,
    ageStartDay: row.age_start_day,
    ageEndDay: row.age_end_day,
    stage: row.stage,
    targetValue: Number(row.target_value),
    minValue: row.min_value == null ? null : Number(row.min_value),
    maxValue: row.max_value == null ? null : Number(row.max_value),
    unit: row.unit,
    interpolationMethod: row.interpolation_method,
  };
}

function rowToCodeValue(row: any): CodeValue {
  return {
    id: row.id,
    organizationId: row.organization_id,
    codeSetId: row.code_set_id,
    code: row.code,
    label: row.label,
    translations: record(row.translations) as Record<string, string>,
    sortOrder: row.sort_order,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    metadata: record(row.metadata),
  };
}

function rowToIdentifier(row: any): QrIdentifier {
  return {
    id: row.id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    printableCode: row.printable_code,
    symbology: row.symbology,
    status: row.status,
    replacedBy: row.replaced_by,
    replacementReason: row.replacement_reason,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    retiredAt: row.retired_at,
  };
}
