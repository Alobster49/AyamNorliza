import { createHash } from "node:crypto";

export type StructureStatus = "draft" | "active" | "maintenance" | "restricted" | "inactive" | "retired";

export type CompletenessInput = {
  site: {
    status: "draft" | "active" | "inactive" | "archived";
    name: string;
    code: string;
    timeZone: string;
    defaultUnitSystem: "metric" | "imperial";
    contacts?: Array<Record<string, unknown>>;
  };
  zones: Array<{ status: string }>;
  houses: Array<{ status: string }>;
  storageLocations: Array<{ status: string }>;
};

export type CompletenessResult = {
  ready: boolean;
  score: number;
  missing: string[];
};

export type TargetCurvePointInput = {
  metric: string;
  ageStartDay: number;
  ageEndDay: number;
  targetValue: number;
  minValue?: number | null;
  maxValue?: number | null;
  unit: string;
};

export type TargetCurveValidationResult = {
  valid: boolean;
  errors: string[];
};

export type LabelEntityType =
  | "house"
  | "site"
  | "zone"
  | "storage_location"
  | "asset"
  | "flock"
  | "lot"
  | "sample"
  | "shipment";

export function calculateHierarchyCompleteness(input: CompletenessInput): CompletenessResult {
  const missing: string[] = [];
  const checks = [
    Boolean(input.site.name.trim()) &&
      Boolean(input.site.code.trim()) &&
      Boolean(input.site.timeZone.trim()) &&
      Boolean(input.site.defaultUnitSystem),
    input.zones.some((zone) => zone.status === "active"),
    input.houses.some((house) => house.status === "active"),
    input.storageLocations.some((location) => location.status === "active"),
    (input.site.contacts ?? []).length > 0,
  ];

  if (input.site.status !== "active") missing.push("site must be active");
  if (!checks[1]) missing.push("at least one active biosecurity zone");
  if (!checks[2]) missing.push("at least one active house");
  if (!checks[3]) missing.push("at least one active storage location");
  if (!checks[4]) missing.push("site contact");

  const passed = checks.filter(Boolean).length;
  return {
    ready: missing.length === 0,
    score: Math.round((passed / checks.length) * 100),
    missing,
  };
}

export function validateTargetCurvePoints(
  points: TargetCurvePointInput[],
): TargetCurveValidationResult {
  const errors: string[] = [];
  const byMetric = new Map<string, TargetCurvePointInput[]>();

  for (const point of points) {
    if (point.ageStartDay < 0 || point.ageEndDay < point.ageStartDay) {
      errors.push(`${point.metric} has an invalid age range ${point.ageStartDay}-${point.ageEndDay}`);
    }
    if (point.minValue != null && point.targetValue < point.minValue) {
      errors.push(`${point.metric} target is below minimum for days ${point.ageStartDay}-${point.ageEndDay}`);
    }
    if (point.maxValue != null && point.targetValue > point.maxValue) {
      errors.push(`${point.metric} target is above maximum for days ${point.ageStartDay}-${point.ageEndDay}`);
    }
    const metricPoints = byMetric.get(point.metric) ?? [];
    metricPoints.push(point);
    byMetric.set(point.metric, metricPoints);
  }

  for (const [metric, metricPoints] of byMetric) {
    const units = Array.from(new Set(metricPoints.map((point) => point.unit))).sort();
    if (units.length > 1) {
      errors.push(`${metric} mixes units: ${units.join(", ")}`);
    }

    const sorted = [...metricPoints].sort((a, b) => {
      if (a.ageStartDay !== b.ageStartDay) return a.ageStartDay - b.ageStartDay;
      return a.ageEndDay - b.ageEndDay;
    });
    const seen = new Set<string>();
    for (let i = 0; i < sorted.length; i += 1) {
      const point = sorted[i]!;
      const key = `${point.ageStartDay}-${point.ageEndDay}`;
      if (seen.has(key)) {
        errors.push(`${metric} has a duplicate point for days ${key}`);
      }
      seen.add(key);

      const next = sorted[i + 1];
      if (next && next.ageStartDay <= point.ageEndDay) {
        errors.push(`${metric} has overlapping age ranges at day ${next.ageStartDay}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function hashTargetProfileDefinition(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function formatLabelCode(input: {
  organizationSlug: string;
  entityType: LabelEntityType;
  entityCode: string;
  entityId: string;
}): string {
  const orgPrefix = input.organizationSlug
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .join("")
    .slice(0, 4)
    .toUpperCase();
  const entity = input.entityType.replace(/[^a-zA-Z0-9]+/gu, "_").toUpperCase();
  const code = input.entityCode.replace(/[^a-zA-Z0-9]+/gu, "").toUpperCase();
  const shortId = input.entityId.replace(/-/gu, "").slice(0, 8).toUpperCase();
  return `${orgPrefix}-${entity}-${code}-${shortId}`;
}

export function buildIdentifierPayload(input: {
  baseUrl: string;
  organizationSlug: string;
  printableCode: string;
}): string {
  const base = input.baseUrl.replace(/\/+$/u, "");
  return `${base}/${input.organizationSlug}/scan?code=${encodeURIComponent(input.printableCode)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}
