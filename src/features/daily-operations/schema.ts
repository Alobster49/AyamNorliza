import { z } from "zod";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const isoTimestamp = z.string().datetime({ offset: true });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const jsonRecord = z.record(z.string(), z.unknown());
const nonEmptyText = z.string().trim().min(1).max(1000);

export const ResponseStatus = z.enum(["ok", "abnormal", "skipped", "corrected"]);
export const ObservationSeverity = z.enum(["info", "low", "medium", "high", "critical"]);

export const StartInspectionInput = z.object({
  organizationId: uuid,
  siteId: uuid,
  houseId: uuid,
  flockId: nullableUuid,
  shiftId: nullableUuid,
  templateVersionId: uuid,
  inspectionId: uuid.optional(),
  clientOperationId: uuid.optional(),
  startedAt: isoTimestamp,
});
export type StartInspectionInput = z.infer<typeof StartInspectionInput>;

export const InspectionResponseInput = z.object({
  questionKey: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200).optional(),
  responseType: z.enum(["boolean", "number", "text", "select"]).default("text"),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  unit: z.string().max(40).nullable().optional(),
  status: ResponseStatus,
  exceptionReason: z.string().max(500).nullable().optional(),
  source: z.enum(["manual", "device", "calculated"]).default("manual"),
});
export type InspectionResponseInput = z.infer<typeof InspectionResponseInput>;

export const CreateObservationInput = z.object({
  organizationId: uuid,
  inspectionId: nullableUuid,
  siteId: uuid,
  houseId: uuid,
  flockId: nullableUuid,
  category: z.enum(["health", "environment", "feed_water", "litter", "equipment", "production", "biosecurity", "other"]),
  severity: ObservationSeverity,
  description: nonEmptyText,
  immediateAction: z.string().max(1000).nullable().optional(),
  followUpType: z.enum(["task", "health_case", "work_order", "biosecurity_incident", "alert_acknowledgement"]).nullable().optional(),
  media: z.array(jsonRecord).default([]),
});
export type CreateObservationInput = z.infer<typeof CreateObservationInput>;

export const SubmitInspectionInput = z.object({
  organizationId: uuid,
  inspectionId: uuid,
  completedAt: isoTimestamp,
  signature: z.string().trim().min(2).max(150),
  responses: z.array(InspectionResponseInput).min(1).max(200),
  observations: z.array(CreateObservationInput.omit({ organizationId: true, inspectionId: true })).max(25).default([]),
});
export type SubmitInspectionInput = z.infer<typeof SubmitInspectionInput>;

export const SyncOperationInput = z.object({
  clientOperationId: uuid,
  entityId: uuid,
  entityType: z.enum(["inspection", "inspection_response", "observation", "handover", "period_close", "correction"]),
  mutationType: z.enum(["create", "update", "submit", "approve", "request_correction"]),
  localEventTime: isoTimestamp,
  localSaveTime: isoTimestamp,
  baseServerVersion: z.number().int().nonnegative().nullable().optional(),
  payloadSchemaVersion: z.number().int().positive(),
  payload: jsonRecord,
  attachmentReferences: z.array(jsonRecord).default([]),
});
export type SyncOperationInput = z.infer<typeof SyncOperationInput>;

export const SubmitSyncOperationsInput = z.object({
  organizationId: uuid,
  operations: z.array(SyncOperationInput).min(1).max(100),
});
export type SubmitSyncOperationsInput = z.infer<typeof SubmitSyncOperationsInput>;

export const CreateShiftInput = z.object({
  organizationId: uuid,
  siteId: uuid,
  name: z.string().trim().min(2).max(120),
  startsAt: isoTimestamp,
  endsAt: isoTimestamp,
  roleRequirements: jsonRecord.default({}),
}).refine((value) => value.endsAt > value.startsAt, {
  message: "shift end must be after start",
  path: ["endsAt"],
});
export type CreateShiftInput = z.infer<typeof CreateShiftInput>;

export const AssignShiftInput = z.object({
  organizationId: uuid,
  shiftId: uuid,
  userId: uuid,
  siteId: uuid,
  houseId: nullableUuid,
  responsibility: z.string().trim().min(2).max(120),
});
export type AssignShiftInput = z.infer<typeof AssignShiftInput>;

export const CreateInspectionTemplateVersionInput = z.object({
  organizationId: uuid,
  templateId: nullableUuid,
  name: z.string().trim().min(2).max(150),
  version: z.string().trim().min(1).max(40),
  productionTypes: z.array(z.string().trim().min(1).max(40)).min(1),
  riskClasses: z.array(z.string().trim().min(1).max(40)).min(1),
  definition: jsonRecord,
  effectiveFrom: isoTimestamp.nullable().optional(),
  effectiveTo: isoTimestamp.nullable().optional(),
});
export type CreateInspectionTemplateVersionInput = z.infer<typeof CreateInspectionTemplateVersionInput>;

export const ApproveInspectionTemplateVersionInput = z.object({
  organizationId: uuid,
  templateVersionId: uuid,
  approvalNotes: z.string().trim().min(5).max(1000),
});
export type ApproveInspectionTemplateVersionInput = z.infer<typeof ApproveInspectionTemplateVersionInput>;

export const CreateHandoverInput = z.object({
  organizationId: uuid,
  siteId: uuid,
  fromShiftId: uuid,
  toShiftId: uuid,
  unresolvedItems: z.array(jsonRecord).default([]),
  restrictions: z.array(jsonRecord).default([]),
  equipmentState: jsonRecord.default({}),
  nextActions: z.array(jsonRecord).default([]),
  acknowledgementNotes: z.string().max(1000).nullable().optional(),
});
export type CreateHandoverInput = z.infer<typeof CreateHandoverInput>;

export const CreatePeriodCloseInput = z.object({
  organizationId: uuid,
  siteId: uuid,
  houseId: nullableUuid,
  periodType: z.enum(["daily", "weekly"]),
  periodStart: isoTimestamp,
  periodEnd: isoTimestamp,
  operatingDate: dateOnly.optional(),
  completeness: jsonRecord,
  reviewerNotes: z.string().max(1000).nullable().optional(),
}).refine((value) => value.periodEnd > value.periodStart, {
  message: "period end must be after start",
  path: ["periodEnd"],
});
export type CreatePeriodCloseInput = z.infer<typeof CreatePeriodCloseInput>;

export const ApprovePeriodCloseInput = z.object({
  organizationId: uuid,
  periodCloseId: uuid,
  approvalNotes: z.string().trim().min(5).max(1000),
});
export type ApprovePeriodCloseInput = z.infer<typeof ApprovePeriodCloseInput>;

export const RequestCorrectionInput = z.object({
  organizationId: uuid,
  targetTable: z.enum(["inspections", "inspection_responses", "observations", "period_closes"]),
  targetRecordId: uuid,
  beforeValue: jsonRecord,
  afterValue: jsonRecord,
  reason: z.string().trim().min(10).max(1000),
  riskLevel: z.enum(["low", "medium", "high"]).default("medium"),
});
export type RequestCorrectionInput = z.infer<typeof RequestCorrectionInput>;

export const ApproveCorrectionInput = z.object({
  organizationId: uuid,
  correctionId: uuid,
  decision: z.enum(["approved", "rejected"]),
  reviewerReason: z.string().trim().min(10).max(1000),
});
export type ApproveCorrectionInput = z.infer<typeof ApproveCorrectionInput>;
