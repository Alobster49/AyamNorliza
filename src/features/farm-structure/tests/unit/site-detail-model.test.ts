import { describe, expect, it } from "vitest";
import {
  buildSiteDetailSummary,
  getReadinessTone,
} from "@/features/farm-structure/site-detail-model";
import type {
  BiosecurityZone,
  House,
  Site,
  StorageLocation,
} from "@/features/farm-structure/types";

const organizationId = "11111111-1111-1111-1111-111111111111";
const siteId = "22222222-2222-2222-2222-222222222222";

const site: Site = {
  id: siteId,
  organizationId,
  name: "Pontian Layer Farm",
  code: "PTN",
  legalName: null,
  address: null,
  latitude: null,
  longitude: null,
  timeZone: "Asia/Kuala_Lumpur",
  defaultUnitSystem: "metric",
  currencyCode: "MYR",
  contacts: [],
  biosecurityLayout: {},
  status: "draft",
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
  version: 1,
};

function zone(overrides: Partial<BiosecurityZone>): BiosecurityZone {
  return {
    id: "zone-1",
    organizationId,
    siteId,
    parentZoneId: null,
    name: "Clean entry",
    code: "ZE1",
    riskClass: "medium",
    entryRules: {},
    status: "active",
    ...overrides,
  };
}

function house(overrides: Partial<House>): House {
  return {
    id: "house-1",
    organizationId,
    siteId,
    zoneId: null,
    code: "H01",
    name: "House 1",
    capacityBirds: 10000,
    lengthMeters: null,
    widthMeters: null,
    heightMeters: null,
    housingSystem: "closed_house",
    productionPurpose: "layer",
    operationalStatus: "draft",
    criticality: "standard",
    coordinates: {},
    floorPlan: {},
    equipment: [],
    ...overrides,
  };
}

function storage(overrides: Partial<StorageLocation>): StorageLocation {
  return {
    id: "storage-1",
    organizationId,
    siteId,
    zoneId: null,
    code: "ST1",
    name: "General store",
    locationType: "general",
    conditions: {},
    restricted: false,
    status: "active",
    ...overrides,
  };
}

describe("getReadinessTone", () => {
  it("labels complete, partial, and blocked readiness states", () => {
    expect(getReadinessTone({ ready: true, score: 100, missing: [] })).toEqual({
      label: "Ready",
      tone: "ready",
    });
    expect(getReadinessTone({ ready: false, score: 60, missing: ["site contact"] })).toEqual({
      label: "Needs setup",
      tone: "warning",
    });
    expect(getReadinessTone({ ready: false, score: 20, missing: ["active house"] })).toEqual({
      label: "Blocked",
      tone: "blocked",
    });
  });
});

describe("buildSiteDetailSummary", () => {
  it("counts total and active child resources for the site workspace", () => {
    expect(
      buildSiteDetailSummary({
        zones: [zone({ status: "active" }), zone({ id: "zone-2", status: "inactive" })],
        houses: [house({ operationalStatus: "active" }), house({ id: "house-2", operationalStatus: "draft" })],
        storageLocations: [
          storage({ status: "active" }),
          storage({ id: "storage-2", status: "maintenance" }),
        ],
      }),
    ).toEqual({
      zones: { active: 1, total: 2 },
      houses: { active: 1, total: 2 },
      storage: { active: 1, total: 2 },
    });
  });
});
