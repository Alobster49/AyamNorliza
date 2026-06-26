import { describe, expect, it } from "vitest";
import {
  calculateBirdBalance,
  canAssignHouseToFlock,
  getAllowedNextFlockStatuses,
  getCurrentFlockStage,
} from "@/features/flocks/domain";

describe("getAllowedNextFlockStatuses", () => {
  it("follows the documented flock lifecycle transitions", () => {
    expect(getAllowedNextFlockStatuses("draft")).toEqual(["planned"]);
    expect(getAllowedNextFlockStatuses("planned")).toEqual(["readiness_pending"]);
    expect(getAllowedNextFlockStatuses("readiness_pending")).toEqual(["ready"]);
    expect(getAllowedNextFlockStatuses("ready")).toEqual(["active"]);
    expect(getAllowedNextFlockStatuses("active")).toEqual(["restricted", "harvest_pending", "depopulated"]);
    expect(getAllowedNextFlockStatuses("restricted")).toEqual(["active"]);
    expect(getAllowedNextFlockStatuses("harvest_pending")).toEqual(["depopulated"]);
    expect(getAllowedNextFlockStatuses("depopulated")).toEqual(["closing"]);
    expect(getAllowedNextFlockStatuses("closing")).toEqual(["closed"]);
    expect(getAllowedNextFlockStatuses("closed")).toEqual([]);
  });
});

describe("calculateBirdBalance", () => {
  it("explains closing live birds from approved count transactions", () => {
    expect(
      calculateBirdBalance({
        openingLiveBirds: 0,
        transactions: [
          { type: "placement", quantity: 1000, approvalStatus: "approved" },
          { type: "mortality", quantity: 8, approvalStatus: "approved" },
          { type: "cull", quantity: 2, approvalStatus: "approved" },
          { type: "transfer_in", quantity: 50, approvalStatus: "approved" },
          { type: "transfer_out", quantity: 100, approvalStatus: "approved" },
          { type: "harvest", quantity: 500, approvalStatus: "approved" },
          { type: "adjustment", quantity: -3, approvalStatus: "approved" },
          { type: "adjustment", quantity: 99, approvalStatus: "pending" },
        ],
      }),
    ).toEqual({
      openingLiveBirds: 0,
      placements: 1000,
      transfersIn: 50,
      mortality: 8,
      culls: 2,
      transfersOut: 100,
      harvestDepopulation: 500,
      adjustments: -3,
      closingLiveBirds: 437,
      pendingAdjustments: 99,
    });
  });
});

describe("getCurrentFlockStage", () => {
  it("selects the target curve stage matching the flock age in days", () => {
    expect(
      getCurrentFlockStage({
        hatchDate: "2026-06-01",
        asOfDate: "2026-06-22T03:00:00.000Z",
        curvePoints: [
          { stage: "starter", ageStartDay: 0, ageEndDay: 14 },
          { stage: "grower", ageStartDay: 15, ageEndDay: 35 },
        ],
      }),
    ).toEqual({ ageDays: 21, stage: "grower" });
  });
});

describe("canAssignHouseToFlock", () => {
  it("blocks incompatible production purpose, capacity overflow, and overlapping open flocks", () => {
    expect(
      canAssignHouseToFlock({
        plannedQuantity: 1200,
        productionType: "layer",
        house: {
          capacityBirds: 1000,
          productionPurpose: "broiler",
          operationalStatus: "active",
        },
        existingFlocks: [{ status: "active" }],
      }),
    ).toEqual({
      ok: false,
      reasons: [
        "house production purpose does not match flock production type",
        "planned quantity exceeds house capacity",
        "house already has an open flock",
      ],
    });
  });
});
