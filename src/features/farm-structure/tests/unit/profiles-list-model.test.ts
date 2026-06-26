import { describe, expect, it } from "vitest";
import {
  buildTargetProfileRows,
  filterProductionProfilesForDisplay,
  filterTargetProfilesForDisplay,
} from "@/features/farm-structure/profiles-list-model";
import type { ProductionProfile, TargetProfile, TargetProfileVersion } from "@/features/farm-structure/types";

const organizationId = "11111111-1111-1111-1111-111111111111";

function production(overrides: Partial<ProductionProfile>): ProductionProfile {
  return {
    id: "profile-1",
    organizationId,
    type: "layer",
    name: "Layer standard",
    workflowOptions: {},
    ownerUserId: null,
    status: "active",
    ...overrides,
  };
}

function target(overrides: Partial<TargetProfile>): TargetProfile {
  return {
    id: "target-1",
    organizationId,
    profileFamily: "Layer pullet",
    productionType: "layer",
    breedStrain: "Lohmann",
    housingSystem: "closed_house",
    region: "MY",
    ownerUserId: null,
    status: "draft",
    ...overrides,
  };
}

function version(overrides: Partial<TargetProfileVersion>): TargetProfileVersion {
  return {
    id: "version-1",
    organizationId,
    targetProfileId: "target-1",
    version: "2026.1",
    effectiveFrom: null,
    effectiveTo: null,
    sourceDocument: null,
    approvalNotes: null,
    approvedBy: null,
    approvedAt: null,
    status: "draft",
    definition: {},
    definitionHash: null,
    ...overrides,
  };
}

describe("profiles list helpers", () => {
  it("filters production profiles by search, type, and status", () => {
    const profiles = [
      production({ id: "profile-1", type: "layer", name: "Layer standard", status: "active" }),
      production({ id: "profile-2", type: "broiler", name: "Fast broiler", status: "draft" }),
    ];

    expect(filterProductionProfilesForDisplay(profiles, { search: "fast", type: "all", status: "all" })).toEqual([profiles[1]]);
    expect(filterProductionProfilesForDisplay(profiles, { search: "", type: "layer", status: "active" })).toEqual([profiles[0]]);
  });

  it("builds target rows with versions and filters by target fields", () => {
    const targets = [
      target({ id: "target-1", profileFamily: "Layer pullet", productionType: "layer", status: "draft" }),
      target({ id: "target-2", profileFamily: "Broiler finisher", productionType: "broiler", breedStrain: "Ross", status: "active" }),
    ];
    const versions = [
      version({ id: "version-1", targetProfileId: "target-1" }),
      version({ id: "version-2", targetProfileId: "target-1", version: "2026.2", status: "approved" }),
    ];

    const rows = buildTargetProfileRows(targets, versions);
    expect(rows[0]?.versions).toHaveLength(2);
    expect(filterTargetProfilesForDisplay(rows, { search: "ross", productionType: "all", status: "all" })).toEqual([rows[1]]);
    expect(filterTargetProfilesForDisplay(rows, { search: "", productionType: "layer", status: "draft" })).toEqual([rows[0]]);
  });
});
