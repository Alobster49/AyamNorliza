export type Site = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  legalName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  timeZone: string;
  defaultUnitSystem: "metric" | "imperial";
  currencyCode: string;
  contacts: Array<Record<string, unknown>>;
  biosecurityLayout: Record<string, unknown>;
  status: "draft" | "active" | "inactive" | "archived";
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type BiosecurityZone = {
  id: string;
  organizationId: string;
  siteId: string;
  parentZoneId: string | null;
  name: string;
  code: string;
  riskClass: "low" | "medium" | "high" | "quarantine";
  entryRules: Record<string, unknown>;
  status: StructureStatus;
};

export type House = {
  id: string;
  organizationId: string;
  siteId: string;
  zoneId: string | null;
  code: string;
  name: string;
  capacityBirds: number;
  lengthMeters: number | null;
  widthMeters: number | null;
  heightMeters: number | null;
  housingSystem: string;
  productionPurpose: ProductionType;
  operationalStatus: StructureStatus;
  criticality: "standard" | "important" | "critical";
  coordinates: Record<string, unknown>;
  floorPlan: Record<string, unknown>;
  equipment: Array<Record<string, unknown>>;
};

export type HouseArea = {
  id: string;
  organizationId: string;
  siteId: string;
  houseId: string;
  code: string;
  name: string;
  areaType: string;
  capacityBirds: number | null;
  sequence: number;
  geometry: Record<string, unknown>;
  status: StructureStatus;
};

export type StorageLocation = {
  id: string;
  organizationId: string;
  siteId: string;
  zoneId: string | null;
  code: string;
  name: string;
  locationType: "feed" | "medicine" | "chemical" | "egg" | "spare_part" | "general";
  conditions: Record<string, unknown>;
  restricted: boolean;
  status: StructureStatus;
};

export type ProductionProfile = {
  id: string;
  organizationId: string;
  type: ProductionType;
  name: string;
  workflowOptions: Record<string, unknown>;
  ownerUserId: string | null;
  status: "draft" | "active" | "inactive";
};

export type TargetProfile = {
  id: string;
  organizationId: string;
  profileFamily: string;
  productionType: ProductionType;
  breedStrain: string;
  housingSystem: string | null;
  region: string | null;
  ownerUserId: string | null;
  status: "draft" | "active" | "retired";
};

export type TargetProfileVersion = {
  id: string;
  organizationId: string;
  targetProfileId: string;
  version: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceDocument: string | null;
  approvalNotes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  status: "draft" | "pending_approval" | "approved" | "superseded" | "retired";
  definition: Record<string, unknown>;
  definitionHash: string | null;
};

export type TargetCurvePoint = {
  id: string;
  organizationId: string;
  targetProfileVersionId: string;
  metric: string;
  ageStartDay: number;
  ageEndDay: number;
  stage: string | null;
  targetValue: number;
  minValue: number | null;
  maxValue: number | null;
  unit: string;
  interpolationMethod: "none" | "linear" | "step";
};

export type CodeSet = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "inactive";
  values: CodeValue[];
};

export type CodeValue = {
  id: string;
  organizationId: string;
  codeSetId: string;
  code: string;
  label: string;
  translations: Record<string, string>;
  sortOrder: number;
  status: "active" | "inactive" | "superseded";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  metadata: Record<string, unknown>;
};

export type QrIdentifier = {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  printableCode: string;
  symbology: "qr" | "code128";
  status: "active" | "replaced" | "retired";
  replacedBy: string | null;
  replacementReason: string | null;
  generatedAt: string;
  generatedBy: string | null;
  retiredAt: string | null;
};

export type StructureStatus = "draft" | "active" | "maintenance" | "restricted" | "inactive" | "retired";
export type ProductionType = "layer" | "broiler" | "breeder" | "smallholder";
