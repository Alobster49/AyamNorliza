import { z } from "zod";

export const SiteStatus = z.enum(["draft", "active", "inactive", "archived"]);
export const StructureStatus = z.enum([
  "draft",
  "active",
  "maintenance",
  "restricted",
  "inactive",
  "retired",
]);
export const UnitSystem = z.enum(["metric", "imperial"]);
export const ProductionProfileType = z.enum(["layer", "broiler", "breeder", "smallholder"]);
export const TargetVersionStatus = z.enum(["draft", "pending_approval", "approved", "superseded", "retired"]);
export const CodeValueStatus = z.enum(["active", "inactive", "superseded"]);
export const LabelEntityType = z.enum([
  "house",
  "site",
  "zone",
  "storage_location",
  "asset",
  "flock",
  "lot",
  "sample",
  "shipment",
]);

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const isoTimestamp = z.string().datetime({ offset: true });
const shortCode = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/u, "code must use uppercase letters, numbers, underscores, or hyphens");
const name = z.string().trim().min(2).max(150);
const timeZone = z.string().regex(/^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/u, "invalid IANA time zone");
const nonNegativeNumber = z.number().finite().nonnegative();

export const CreateSiteInput = z.object({
  organizationId: uuid,
  name,
  code: shortCode,
  legalName: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  latitude: z.number().gte(-90).lte(90).nullable().optional(),
  longitude: z.number().gte(-180).lte(180).nullable().optional(),
  timeZone,
  defaultUnitSystem: UnitSystem.default("metric"),
  currencyCode: z.string().length(3).default("MYR"),
  contacts: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
  biosecurityLayout: z.record(z.string(), z.unknown()).default({}),
  status: SiteStatus.default("draft"),
});
export type CreateSiteInput = z.infer<typeof CreateSiteInput>;

export const UpdateSiteInput = CreateSiteInput.partial()
  .extend({
    siteId: uuid,
    organizationId: uuid,
  })
  .omit({ code: true });
export type UpdateSiteInput = z.infer<typeof UpdateSiteInput>;

export const CreateZoneInput = z.object({
  organizationId: uuid,
  siteId: uuid,
  parentZoneId: nullableUuid,
  name,
  code: shortCode,
  riskClass: z.enum(["low", "medium", "high", "quarantine"]).default("medium"),
  entryRules: z.record(z.string(), z.unknown()).default({}),
  status: StructureStatus.default("draft"),
});
export type CreateZoneInput = z.infer<typeof CreateZoneInput>;

export const CreateHouseInput = z.object({
  organizationId: uuid,
  siteId: uuid,
  zoneId: nullableUuid,
  code: shortCode,
  name,
  capacityBirds: z.number().int().nonnegative(),
  lengthMeters: nonNegativeNumber.nullable().optional(),
  widthMeters: nonNegativeNumber.nullable().optional(),
  heightMeters: nonNegativeNumber.nullable().optional(),
  housingSystem: z.enum(["closed_house", "open_sided", "cage", "aviary", "deep_litter", "free_range", "other"]),
  productionPurpose: ProductionProfileType,
  operationalStatus: StructureStatus.default("draft"),
  criticality: z.enum(["standard", "important", "critical"]).default("standard"),
  coordinates: z.record(z.string(), z.unknown()).default({}),
  floorPlan: z.record(z.string(), z.unknown()).default({}),
  equipment: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type CreateHouseInput = z.infer<typeof CreateHouseInput>;

export const CreateHouseAreaInput = z.object({
  organizationId: uuid,
  houseId: uuid,
  code: shortCode,
  name,
  areaType: z.enum(["room", "pen", "tier", "section", "sensor_zone", "other"]).default("section"),
  capacityBirds: z.number().int().nonnegative().nullable().optional(),
  sequence: z.number().int().nonnegative().default(0),
  geometry: z.record(z.string(), z.unknown()).default({}),
  status: StructureStatus.default("active"),
});
export type CreateHouseAreaInput = z.infer<typeof CreateHouseAreaInput>;

export const CreateStorageLocationInput = z.object({
  organizationId: uuid,
  siteId: uuid,
  zoneId: nullableUuid,
  code: shortCode,
  name,
  locationType: z.enum(["feed", "medicine", "chemical", "egg", "spare_part", "general"]),
  conditions: z.record(z.string(), z.unknown()).default({}),
  restricted: z.boolean().default(false),
  status: StructureStatus.default("draft"),
});
export type CreateStorageLocationInput = z.infer<typeof CreateStorageLocationInput>;

export const UpsertProductionProfileInput = z.object({
  organizationId: uuid,
  profileId: uuid.optional(),
  type: ProductionProfileType,
  name,
  workflowOptions: z.record(z.string(), z.unknown()).default({}),
  ownerUserId: uuid.nullable().optional(),
  status: z.enum(["draft", "active", "inactive"]).default("draft"),
});
export type UpsertProductionProfileInput = z.infer<typeof UpsertProductionProfileInput>;

export const UpsertTargetProfileInput = z.object({
  organizationId: uuid,
  targetProfileId: uuid.optional(),
  profileFamily: z.string().min(2).max(120),
  productionType: ProductionProfileType,
  breedStrain: z.string().min(1).max(120),
  housingSystem: z.string().max(120).nullable().optional(),
  region: z.string().max(80).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
});
export type UpsertTargetProfileInput = z.infer<typeof UpsertTargetProfileInput>;

export const TargetCurvePointInput = z
  .object({
    metric: z.string().min(1).max(100),
    ageStartDay: z.number().int().nonnegative(),
    ageEndDay: z.number().int().nonnegative(),
    stage: z.string().max(100).nullable().optional(),
    targetValue: z.number().finite(),
    minValue: z.number().finite().nullable().optional(),
    maxValue: z.number().finite().nullable().optional(),
    unit: z.string().min(1).max(50),
    interpolationMethod: z.enum(["none", "linear", "step"]).default("linear"),
  })
  .refine((value) => value.ageEndDay >= value.ageStartDay, {
    message: "ageEndDay must be greater than or equal to ageStartDay",
    path: ["ageEndDay"],
  })
  .refine((value) => value.minValue == null || value.targetValue >= value.minValue, {
    message: "targetValue must be greater than or equal to minValue",
    path: ["targetValue"],
  })
  .refine((value) => value.maxValue == null || value.targetValue <= value.maxValue, {
    message: "targetValue must be less than or equal to maxValue",
    path: ["targetValue"],
  });
export type TargetCurvePointInput = z.infer<typeof TargetCurvePointInput>;

export const CreateTargetProfileVersionInput = z
  .object({
    organizationId: uuid,
    targetProfileId: uuid,
    version: z.string().min(1).max(40),
    effectiveFrom: isoTimestamp.nullable().optional(),
    effectiveTo: isoTimestamp.nullable().optional(),
    sourceDocument: z.string().max(500).nullable().optional(),
    approvalNotes: z.string().max(1000).nullable().optional(),
    status: TargetVersionStatus.default("draft"),
    definition: z.record(z.string(), z.unknown()).default({}),
    points: z.array(TargetCurvePointInput).min(1).max(2000),
  })
  .refine(
    (value) =>
      !value.effectiveFrom ||
      !value.effectiveTo ||
      new Date(value.effectiveTo).getTime() > new Date(value.effectiveFrom).getTime(),
    { message: "effectiveTo must be after effectiveFrom", path: ["effectiveTo"] },
  );
export type CreateTargetProfileVersionInput = z.infer<typeof CreateTargetProfileVersionInput>;

export const ApproveTargetProfileVersionInput = z.object({
  organizationId: uuid,
  versionId: uuid,
  effectiveFrom: isoTimestamp,
  approvalNotes: z.string().min(3).max(1000),
});
export type ApproveTargetProfileVersionInput = z.infer<typeof ApproveTargetProfileVersionInput>;

export const UpsertCodeSetInput = z.object({
  organizationId: uuid,
  codeSetId: uuid.optional(),
  key: z.string().min(2).max(80).regex(/^[a-z0-9_.-]+$/u),
  name,
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["draft", "active", "inactive"]).default("draft"),
});
export type UpsertCodeSetInput = z.infer<typeof UpsertCodeSetInput>;

export const UpsertCodeValueInput = z
  .object({
    organizationId: uuid,
    codeSetId: uuid,
    codeValueId: uuid.optional(),
    code: shortCode,
    label: z.string().min(1).max(150),
    translations: z.record(z.string(), z.string()).default({}),
    sortOrder: z.number().int().min(0).default(0),
    status: CodeValueStatus.default("active"),
    effectiveFrom: isoTimestamp.nullable().optional(),
    effectiveTo: isoTimestamp.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (value) =>
      !value.effectiveFrom ||
      !value.effectiveTo ||
      new Date(value.effectiveTo).getTime() > new Date(value.effectiveFrom).getTime(),
    { message: "effectiveTo must be after effectiveFrom", path: ["effectiveTo"] },
  );
export type UpsertCodeValueInput = z.infer<typeof UpsertCodeValueInput>;

export const GenerateIdentifierInput = z.object({
  organizationId: uuid,
  entityType: LabelEntityType,
  entityId: uuid,
  entityCode: shortCode,
  symbology: z.enum(["qr", "code128"]).default("qr"),
});
export type GenerateIdentifierInput = z.infer<typeof GenerateIdentifierInput>;
