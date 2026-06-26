import { describe, expect, it } from "vitest";
import { filterStorageForDisplay } from "@/features/farm-structure/storage-list-model";
import type { BiosecurityZone, Site, StorageLocation } from "@/features/farm-structure/types";

const organizationId = "11111111-1111-1111-1111-111111111111";

function site(overrides: Partial<Site>): Site {
  return {
    id: "site-1",
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
    status: "active",
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function zone(overrides: Partial<BiosecurityZone>): BiosecurityZone {
  return {
    id: "zone-1",
    organizationId,
    siteId: "site-1",
    parentZoneId: null,
    name: "Clean entry",
    code: "ZE1",
    riskClass: "medium",
    entryRules: {},
    status: "active",
    ...overrides,
  };
}

function storage(overrides: Partial<StorageLocation>): StorageLocation {
  return {
    id: "store-1",
    organizationId,
    siteId: "site-1",
    zoneId: "zone-1",
    code: "ST1",
    name: "Feed store",
    locationType: "feed",
    conditions: {},
    restricted: false,
    status: "active",
    ...overrides,
  };
}

describe("filterStorageForDisplay", () => {
  const sites = [
    site({ id: "site-1", name: "Pontian Layer Farm", code: "PTN" }),
    site({ id: "site-2", name: "Melaka Broiler Farm", code: "MLK" }),
  ];
  const zones = [
    zone({ id: "zone-1", siteId: "site-1", code: "CLEAN" }),
    zone({ id: "zone-2", siteId: "site-2", code: "MED" }),
  ];
  const stores = [
    storage({ id: "store-1", siteId: "site-1", zoneId: "zone-1", name: "Feed store", code: "FD1", locationType: "feed", restricted: false, status: "active" }),
    storage({ id: "store-2", siteId: "site-2", zoneId: "zone-2", name: "Medicine cabinet", code: "MD1", locationType: "medicine", restricted: true, status: "restricted" }),
  ];

  it("searches storage, site, zone, and type fields", () => {
    expect(filterStorageForDisplay(stores, sites, zones, { search: "MLK", siteId: "all", zoneId: "all", type: "all", restricted: "all", status: "all" })).toEqual([stores[1]]);
    expect(filterStorageForDisplay(stores, sites, zones, { search: "clean", siteId: "all", zoneId: "all", type: "all", restricted: "all", status: "all" })).toEqual([stores[0]]);
  });

  it("combines site, type, restricted, and status filters", () => {
    expect(filterStorageForDisplay(stores, sites, zones, { search: "", siteId: "site-2", zoneId: "all", type: "medicine", restricted: "restricted", status: "restricted" })).toEqual([stores[1]]);
  });
});
