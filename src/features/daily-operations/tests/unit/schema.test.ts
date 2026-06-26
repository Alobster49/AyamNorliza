import { describe, expect, it } from "vitest";
import {
  ApproveCorrectionInput,
  CreatePeriodCloseInput,
  StartInspectionInput,
  SubmitInspectionInput,
  SubmitSyncOperationsInput,
} from "@/features/daily-operations/schema";

const organizationId = "11111111-1111-1111-1111-111111111111";
const siteId = "22222222-2222-2222-2222-222222222222";
const houseId = "33333333-3333-3333-3333-333333333333";
const flockId = "44444444-4444-4444-4444-444444444444";
const templateVersionId = "55555555-5555-5555-5555-555555555555";
const inspectionId = "66666666-6666-6666-6666-666666666666";

describe("StartInspectionInput", () => {
  it("accepts a client-generated inspection id for offline starts", () => {
    expect(
      StartInspectionInput.safeParse({
        organizationId,
        siteId,
        houseId,
        flockId,
        templateVersionId,
        inspectionId,
        clientOperationId: "77777777-7777-7777-7777-777777777777",
        startedAt: "2026-06-26T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("SubmitInspectionInput", () => {
  it("rejects completion without responses", () => {
    expect(
      SubmitInspectionInput.safeParse({
        organizationId,
        inspectionId,
        completedAt: "2026-06-26T00:15:00.000Z",
        signature: "Caretaker A",
        responses: [],
      }).success,
    ).toBe(false);
  });
});

describe("SubmitSyncOperationsInput", () => {
  it("requires idempotent client operation ids", () => {
    expect(
      SubmitSyncOperationsInput.safeParse({
        organizationId,
        operations: [
          {
            clientOperationId: "88888888-8888-8888-8888-888888888888",
            entityId: inspectionId,
            entityType: "inspection",
            mutationType: "submit",
            localEventTime: "2026-06-26T00:15:00.000Z",
            localSaveTime: "2026-06-26T00:16:00.000Z",
            payloadSchemaVersion: 1,
            payload: { inspectionId },
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("CreatePeriodCloseInput", () => {
  it("requires the period end after the start", () => {
    expect(
      CreatePeriodCloseInput.safeParse({
        organizationId,
        siteId,
        houseId,
        periodType: "daily",
        periodStart: "2026-06-26T16:00:00.000Z",
        periodEnd: "2026-06-26T00:00:00.000Z",
        completeness: { requiredRounds: 1, completedRounds: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("ApproveCorrectionInput", () => {
  it("requires a reviewer reason", () => {
    expect(
      ApproveCorrectionInput.safeParse({
        organizationId,
        correctionId: "99999999-9999-9999-9999-999999999999",
        decision: "approved",
        reviewerReason: "Verified against signed round sheet.",
      }).success,
    ).toBe(true);
  });
});
