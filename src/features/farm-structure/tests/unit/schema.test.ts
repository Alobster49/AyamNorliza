import { describe, expect, it } from "vitest";
import {
  CreateHouseInput,
  CreateSiteInput,
  CreateTargetProfileVersionInput,
  GenerateIdentifierInput,
  UpsertCodeValueInput,
} from "@/features/farm-structure/schema";

const organizationId = "11111111-1111-1111-1111-111111111111";
const siteId = "22222222-2222-2222-2222-222222222222";
const profileId = "33333333-3333-3333-3333-333333333333";

describe("CreateSiteInput", () => {
  it("accepts a minimal active Malaysian farm site", () => {
    const result = CreateSiteInput.safeParse({
      organizationId,
      name: "Pontian Layer Farm",
      code: "PTN",
      timeZone: "Asia/Kuala_Lumpur",
      defaultUnitSystem: "metric",
      status: "draft",
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid site codes and time zones", () => {
    expect(
      CreateSiteInput.safeParse({
        organizationId,
        name: "Pontian Layer Farm",
        code: "pontian farm",
        timeZone: "Malaysia",
      }).success,
    ).toBe(false);
  });
});

describe("CreateHouseInput", () => {
  it("requires non-negative capacity and dimensions", () => {
    expect(
      CreateHouseInput.safeParse({
        organizationId,
        siteId,
        code: "H01",
        name: "House 1",
        capacityBirds: -1,
        lengthMeters: 100,
        widthMeters: 12,
        housingSystem: "closed_house",
        productionPurpose: "layer",
      }).success,
    ).toBe(false);
  });
});

describe("CreateTargetProfileVersionInput", () => {
  it("requires at least one curve point before a version can be created", () => {
    expect(
      CreateTargetProfileVersionInput.safeParse({
        organizationId,
        targetProfileId: profileId,
        version: "2026.1",
        status: "draft",
        points: [],
      }).success,
    ).toBe(false);
  });
});

describe("UpsertCodeValueInput", () => {
  it("requires effective end after effective start", () => {
    expect(
      UpsertCodeValueInput.safeParse({
        organizationId,
        codeSetId: "44444444-4444-4444-4444-444444444444",
        code: "ND",
        label: "Newcastle disease",
        status: "active",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2025-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("GenerateIdentifierInput", () => {
  it("accepts known label entity types only", () => {
    expect(
      GenerateIdentifierInput.safeParse({
        organizationId,
        entityType: "house",
        entityId: "55555555-5555-5555-5555-555555555555",
        entityCode: "H01",
      }).success,
    ).toBe(true);
    expect(
      GenerateIdentifierInput.safeParse({
        organizationId,
        entityType: "unknown",
        entityId: "55555555-5555-5555-5555-555555555555",
        entityCode: "H01",
      }).success,
    ).toBe(false);
  });
});
