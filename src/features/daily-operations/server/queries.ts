import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedDb } from "@/features/farm-structure/server/db";
import { matchTemplateForRound } from "../domain";
import type {
  DueRound,
  Inspection,
  InspectionTemplateVersion,
  Observation,
  PeriodClose,
} from "../types";

export async function listTemplateVersions(organizationId: string): Promise<InspectionTemplateVersion[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("inspection_template_versions")
    .select("id, organization_id, template_id, version, production_types, risk_classes, status, definition, effective_from, effective_to")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToTemplateVersion);
}

export async function getTemplateVersion(templateVersionId: string): Promise<InspectionTemplateVersion | null> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("inspection_template_versions")
    .select("id, organization_id, template_id, version, production_types, risk_classes, status, definition, effective_from, effective_to")
    .eq("id", templateVersionId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToTemplateVersion(data) : null;
}

export async function listTodayRounds(organizationId: string): Promise<DueRound[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const [sitesResult, housesResult, flocksResult, templatesResult, inspectionsResult] = await Promise.all([
    db.from("sites").select("id, code").eq("organization_id", organizationId),
    db
      .from("houses")
      .select("id, site_id, code, name, production_purpose, criticality, operational_status")
      .eq("organization_id", organizationId)
      .in("operational_status", ["active", "restricted", "maintenance"]),
    db
      .from("flocks")
      .select("id, site_id, house_id, code, production_type, status")
      .eq("organization_id", organizationId)
      .in("status", ["active", "restricted", "harvest_pending"]),
    db
      .from("inspection_template_versions")
      .select("id, version, status, production_types, risk_classes")
      .eq("organization_id", organizationId),
    db
      .from("inspections")
      .select("id, house_id, status, started_at")
      .eq("organization_id", organizationId)
      .gte("started_at", startOfTodayIso()),
  ]);
  for (const result of [sitesResult, housesResult, flocksResult, templatesResult, inspectionsResult]) {
    if (result.error) throw result.error;
  }

  const sitesById = new Map<string, any>((sitesResult.data ?? []).map((site: any) => [site.id, site]));
  const flocksByHouseId = new Map<string, any>((flocksResult.data ?? []).map((flock: any) => [flock.house_id, flock]));
  const latestInspectionByHouseId = new Map<string, any>((inspectionsResult.data ?? []).map((inspection: any) => [inspection.house_id, inspection]));
  const templates = (templatesResult.data ?? []).map((template: any) => ({
    id: template.id,
    version: template.version,
    status: template.status,
    productionTypes: stringArray(template.production_types),
    riskClasses: stringArray(template.risk_classes),
  }));

  return (housesResult.data ?? []).map((house: any) => {
    const site = sitesById.get(house.site_id);
    const flock = flocksByHouseId.get(house.id);
    const riskClass = house.criticality === "critical" ? "high" : house.criticality === "important" ? "medium" : "low";
    const productionType = flock?.production_type ?? house.production_purpose;
    const match = matchTemplateForRound({
      productionType,
      houseRiskClass: riskClass,
      templates,
    });
    const inspection = latestInspectionByHouseId.get(house.id);
    return {
      houseId: house.id,
      houseCode: house.code,
      houseName: house.name,
      siteId: house.site_id,
      siteCode: site?.code ?? "SITE",
      flockId: flock?.id ?? null,
      flockCode: flock?.code ?? null,
      productionType,
      riskClass,
      templateVersionId: match?.id ?? null,
      templateVersion: match?.version ?? null,
      status: match ? inspection?.status ?? "due" : "missing_template",
      inspectionId: inspection?.id ?? null,
      dueAt: new Date().toISOString(),
    };
  });
}

export async function listInspections(organizationId: string): Promise<Inspection[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("inspections")
    .select("id, organization_id, site_id, house_id, flock_id, shift_id, template_version_id, status, started_at, completed_at, started_by, completed_by, quality_score, sync_status")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map(rowToInspection);
}

export async function getInspection(inspectionId: string): Promise<{
  inspection: Inspection | null;
  template: InspectionTemplateVersion | null;
  responses: Array<Record<string, unknown>>;
  observations: Observation[];
}> {
  const db = untypedDb(await createSupabaseServerClient());
  const inspectionResult = await db
    .from("inspections")
    .select("id, organization_id, site_id, house_id, flock_id, shift_id, template_version_id, status, started_at, completed_at, started_by, completed_by, quality_score, sync_status")
    .eq("id", inspectionId)
    .maybeSingle();
  if (inspectionResult.error) throw inspectionResult.error;
  if (!inspectionResult.data) return { inspection: null, template: null, responses: [], observations: [] };
  const [template, responses, observations] = await Promise.all([
    getTemplateVersion(inspectionResult.data.template_version_id),
    db.from("inspection_responses").select("*").eq("inspection_id", inspectionId).order("created_at", { ascending: true }),
    listObservationsForInspection(inspectionId),
  ]);
  if (responses.error) throw responses.error;
  return {
    inspection: rowToInspection(inspectionResult.data),
    template,
    responses: responses.data ?? [],
    observations,
  };
}

export async function listOpenObservations(organizationId: string): Promise<Observation[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("observations")
    .select("id, organization_id, inspection_id, site_id, house_id, flock_id, category, severity, description, immediate_action, status, created_at")
    .eq("organization_id", organizationId)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToObservation);
}

export async function listPeriodCloses(organizationId: string): Promise<PeriodClose[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("period_closes")
    .select("id, organization_id, site_id, house_id, period_type, period_start, period_end, status, completeness, approved_at")
    .eq("organization_id", organizationId)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToPeriodClose);
}

export async function getHouseRoundContext(organizationId: string, houseId: string): Promise<DueRound | null> {
  const rounds = await listTodayRounds(organizationId);
  return rounds.find((round) => round.houseId === houseId) ?? null;
}

async function listObservationsForInspection(inspectionId: string): Promise<Observation[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("observations")
    .select("id, organization_id, inspection_id, site_id, house_id, flock_id, category, severity, description, immediate_action, status, created_at")
    .eq("inspection_id", inspectionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToObservation);
}

function rowToTemplateVersion(row: any): InspectionTemplateVersion {
  return {
    id: row.id,
    organizationId: row.organization_id,
    templateId: row.template_id,
    version: row.version,
    productionTypes: stringArray(row.production_types),
    riskClasses: stringArray(row.risk_classes),
    status: row.status,
    definition: isRecord(row.definition) ? row.definition as InspectionTemplateVersion["definition"] : { sections: [] },
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

function rowToInspection(row: any): Inspection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    houseId: row.house_id,
    flockId: row.flock_id,
    shiftId: row.shift_id,
    templateVersionId: row.template_version_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    startedBy: row.started_by,
    completedBy: row.completed_by,
    qualityScore: row.quality_score,
    syncStatus: row.sync_status,
  };
}

function rowToObservation(row: any): Observation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    inspectionId: row.inspection_id,
    siteId: row.site_id,
    houseId: row.house_id,
    flockId: row.flock_id,
    category: row.category,
    severity: row.severity,
    description: row.description,
    immediateAction: row.immediate_action,
    status: row.status,
    createdAt: row.created_at,
  };
}

function rowToPeriodClose(row: any): PeriodClose {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    houseId: row.house_id,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    completeness: isRecord(row.completeness) ? row.completeness : {},
    approvedAt: row.approved_at,
  };
}

function startOfTodayIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
