import { describe, expect, it } from "vitest";
import { filterZonesForDisplay } from "@/features/farm-structure/zones-list-model";
import type {
  BiosecurityZone,
  Site,
} from "@/features/farm-structure/types";

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

describe("filterZonesForDisplay", () => {
  const sites = [
    site({ id: "site-1", name: "Pontian Layer Farm", code: "PTN" }),
    site({ id: "site-2", name: "Melaka Broiler Farm", code: "MLK" }),
  ];
  const zones = [
    zone({ id: "zone-1", siteId: "site-1", name: "Clean entry", code: "ZE1", riskClass: "low", status: "active" }),
    zone({ id: "zone-2", siteId: "site-1", name: "Quarantine yard", code: "ZQ1", riskClass: "quarantine", status: "restricted" }),
    zone({ id: "zone-3", siteId: "site-2", name: "Feed receiving", code: "ZF2", riskClass: "medium", status: "draft" }),
  ];

  it("searches zone and site text fields", () => {
    expect(filterZonesForDisplay(zones, sites, { search: "quarantine", siteId: "all", risk: "all", status: "all" })).toEqual([zones[1]]);
    expect(filterZonesForDisplay(zones, sites, { search: "MLK", siteId: "all", risk: "all", status: "all" })).toEqual([zones[2]]);
  });

  it("combines site, risk, and status filters", () => {
    expect(
      filterZonesForDisplay(zones, sites, {
        search: "",
        siteId: "site-1",
        risk: "quarantine",
        status: "restricted",
      }),
    ).toEqual([zones[1]]);
  });
});
