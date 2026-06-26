import { z } from "zod";

export const FlockStatus = z.enum([
  "draft",
  "planned",
  "readiness_pending",
  "ready",
  "active",
  "restricted",
  "harvest_pending",
  "depopulated",
  "closing",
  "closed",
]);
export const ProductionType = z.enum(["layer", "broiler", "breeder", "smallholder"]);
export const FlockSex = z.enum(["mixed", "female", "male", "unknown"]);
export const ChecklistStatus = z.enum(["pass", "fail", "exception", "not_applicable"]);
export const MovementType = z.enum(["transfer_in", "transfer_out", "split", "merge", "partial_removal"]);

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const shortCode = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/u, "code must use uppercase letters, numbers, underscores, or hyphens");
const name = z.string().trim().min(2).max(150);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "date must use YYYY-MM-DD");
const isoTimestamp = z.string().datetime({ offset: true });
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

export const CreateFlockPlanInput = z
  .object({
    organizationId: uuid,
    siteId: uuid,
    houseId: nullableUuid,
    productionProfileId: uuid,
    targetProfileVersionId: nullableUuid,
    code: shortCode,
    name,
    productionType: ProductionType,
    sourceName: z.string().trim().min(2).max(150),
    breedStrain: z.string().trim().min(1).max(120),
    sex: FlockSex.default("unknown"),
    hatchDate: dateOnly,
    plannedArrivalDate: dateOnly,
    expectedEndDate: dateOnly.nullable().optional(),
    plannedQuantity: positiveInteger,
    planNotes: z.string().max(1000).nullable().optional(),
  })
  .refine((value) => value.plannedArrivalDate >= value.hatchDate, {
    message: "planned arrival must be on or after hatch date",
    path: ["plannedArrivalDate"],
  })
  .refine((value) => !value.expectedEndDate || value.expectedEndDate >= value.plannedArrivalDate, {
    message: "expected end must be on or after planned arrival",
    path: ["expectedEndDate"],
  });
export type CreateFlockPlanInput = z.infer<typeof CreateFlockPlanInput>;

export const ApproveFlockPlanInput = z.object({
  organizationId: uuid,
  flockId: uuid,
  approvalNotes: z.string().trim().min(10).max(1000),
});
export type ApproveFlockPlanInput = z.infer<typeof ApproveFlockPlanInput>;

export const ReadinessChecklistItemInput = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_.-]+$/u),
  label: z.string().min(2).max(150),
  status: ChecklistStatus,
  notes: z.string().max(500).nullable().optional(),
});
export type ReadinessChecklistItemInput = z.infer<typeof ReadinessChecklistItemInput>;

export const ApproveHouseReadinessInput = z.object({
  organizationId: uuid,
  flockId: uuid,
  checklistVersion: z.string().min(1).max(40),
  results: z.array(ReadinessChecklistItemInput).min(1).max(50),
  approverNotes: z.string().trim().min(5).max(1000),
});
export type ApproveHouseReadinessInput = z.infer<typeof ApproveHouseReadinessInput>;

export const RecordPlacementInput = z
  .object({
    organizationId: uuid,
    flockId: uuid,
    placementTime: isoTimestamp,
    actualQuantity: positiveInteger,
    doaQuantity: nonNegativeInteger.default(0),
    vehicleReference: z.string().max(120).nullable().optional(),
    supplierReference: z.string().max(120).nullable().optional(),
    initialObservations: z.string().max(1000).nullable().optional(),
  })
  .refine((value) => value.doaQuantity <= value.actualQuantity, {
    message: "DOA quantity cannot exceed actual quantity",
    path: ["doaQuantity"],
  });
export type RecordPlacementInput = z.infer<typeof RecordPlacementInput>;

export const RecordFlockMovementInput = z.object({
  organizationId: uuid,
  sourceFlockId: uuid,
  destinationFlockId: nullableUuid,
  destinationHouseId: nullableUuid,
  movementType: MovementType,
  quantity: positiveInteger,
  reason: z.string().trim().min(5).max(500),
});
export type RecordFlockMovementInput = z.infer<typeof RecordFlockMovementInput>;

export const RecordHarvestPlanInput = z.object({
  organizationId: uuid,
  flockId: uuid,
  plannedDate: dateOnly,
  destination: z.string().trim().min(2).max(150),
  expectedQuantity: positiveInteger,
  expectedWeightKg: z.number().finite().positive().nullable().optional(),
  crewNotes: z.string().max(1000).nullable().optional(),
  vehicleReference: z.string().max(120).nullable().optional(),
});
export type RecordHarvestPlanInput = z.infer<typeof RecordHarvestPlanInput>;

export const CloseFlockInput = z.object({
  organizationId: uuid,
  flockId: uuid,
  finalLiveBirds: nonNegativeInteger,
  reconciliation: z.record(z.string(), z.unknown()).default({}),
  approvalNotes: z.string().trim().min(10).max(1000),
});
export type CloseFlockInput = z.infer<typeof CloseFlockInput>;
