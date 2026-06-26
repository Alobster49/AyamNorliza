import { describe, expect, it } from "vitest";
import {
  ApproveFlockPlanInput,
  ApproveHouseReadinessInput,
  CloseFlockInput,
  CreateFlockPlanInput,
  RecordFlockMovementInput,
  RecordHarvestPlanInput,
  RecordPlacementInput,
} from "@/features/flocks/schema";

const organizationId = "11111111-1111-1111-1111-111111111111";
const siteId = "22222222-2222-2222-2222-222222222222";
const houseId = "33333333-3333-3333-3333-333333333333";
const profileId = "44444444-4444-4444-4444-444444444444";
const targetVersionId = "55555555-5555-5555-5555-555555555555";
const flockId = "66666666-6666-6666-6666-666666666666";

describe("CreateFlockPlanInput", () => {
  it("accepts a minimal planned layer flock", () => {
    expect(
      CreateFlockPlanInput.safeParse({
        organizationId,
        siteId,
        houseId,
        productionProfileId: profileId,
        targetProfileVersionId: targetVersionId,
        code: "L2026-01",
        name: "Layer cycle 2026-01",
        productionType: "layer",
        sourceName: "Johor Hatchery",
        breedStrain: "Lohmann Brown",
        sex: "female",
        hatchDate: "2026-06-01",
        plannedArrivalDate: "2026-06-03",
        expectedEndDate: "2027-08-01",
        plannedQuantity: 1000,
        planNotes: "Pilot cycle",
      }).success,
    ).toBe(true);
  });

  it("rejects non-positive planned quantities and invalid date order", () => {
    expect(
      CreateFlockPlanInput.safeParse({
        organizationId,
        siteId,
        houseId,
        productionProfileId: profileId,
        code: "BAD",
        name: "Bad flock",
        productionType: "layer",
        sourceName: "Johor Hatchery",
        breedStrain: "Lohmann Brown",
        hatchDate: "2026-06-10",
        plannedArrivalDate: "2026-06-03",
        plannedQuantity: 0,
      }).success,
    ).toBe(false);
  });
});

describe("workflow action inputs", () => {
  it("requires a meaningful approval note for plan approval", () => {
    expect(
      ApproveFlockPlanInput.safeParse({
        organizationId,
        flockId,
        approvalNotes: "Capacity, source documents, and target profile reviewed.",
      }).success,
    ).toBe(true);
    expect(ApproveFlockPlanInput.safeParse({ organizationId, flockId, approvalNotes: "ok" }).success).toBe(false);
  });

  it("requires readiness checklist results before release", () => {
    expect(
      ApproveHouseReadinessInput.safeParse({
        organizationId,
        flockId,
        checklistVersion: "v1",
        results: [
          { key: "sanitation", label: "Sanitation release", status: "pass" },
          { key: "calibration", label: "Calibration", status: "pass" },
        ],
        approverNotes: "House ready for placement.",
      }).success,
    ).toBe(true);
  });

  it("rejects placement where DOA exceeds actual received quantity", () => {
    expect(
      RecordPlacementInput.safeParse({
        organizationId,
        flockId,
        placementTime: "2026-06-03T08:00:00.000Z",
        actualQuantity: 1000,
        doaQuantity: 1001,
        vehicleReference: "TRUCK-1",
      }).success,
    ).toBe(false);
  });

  it("accepts movement, harvest, and closeout workflow records", () => {
    expect(
      RecordFlockMovementInput.safeParse({
        organizationId,
        sourceFlockId: flockId,
        movementType: "transfer_out",
        quantity: 100,
        reason: "Move to recovery pen",
      }).success,
    ).toBe(true);
    expect(
      RecordHarvestPlanInput.safeParse({
        organizationId,
        flockId,
        plannedDate: "2026-07-20",
        destination: "Processing partner",
        expectedQuantity: 900,
      }).success,
    ).toBe(true);
    expect(
      CloseFlockInput.safeParse({
        organizationId,
        flockId,
        finalLiveBirds: 0,
        reconciliation: { birdBalanceReviewed: true },
        approvalNotes: "Final records reconciled.",
      }).success,
    ).toBe(true);
  });
});
