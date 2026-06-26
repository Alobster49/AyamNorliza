import { describe, expect, it } from "vitest";
import { filterSitesForDisplay } from "@/features/farm-structure/sites-list-model";
import type { Site } from "@/features/farm-structure/types";

const baseSite: Site = {
  id: "11111111-1111-1111-1111-111111111111",
  organizationId: "22222222-2222-2222-2222-222222222222",
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

function site(overrides: Partial<Site>): Site {
  return { ...baseSite, ...overrides };
}

describe("filterSitesForDisplay", () => {
  const sites = [
    site({ id: "site-1", code: "PTN", name: "Pontian Layer Farm", status: "draft" }),
    site({
      id: "site-2",
      code: "JB01",
      name: "Johor Broiler Farm",
      status: "active",
      currencyCode: "SGD",
    }),
    site({
      id: "site-3",
      code: "KCH",
      name: "Kuching Storage Hub",
      status: "inactive",
      timeZone: "Asia/Kuching",
    }),
  ];

  it("filters sites by search text across name, code, time zone, and currency", () => {
    expect(filterSitesForDisplay(sites, { search: "broiler", status: "all" }).map((item) => item.id)).toEqual([
      "site-2",
    ]);
    expect(filterSitesForDisplay(sites, { search: "kuching", status: "all" }).map((item) => item.id)).toEqual([
      "site-3",
    ]);
    expect(filterSitesForDisplay(sites, { search: "sgd", status: "all" }).map((item) => item.id)).toEqual([
      "site-2",
    ]);
  });

  it("filters sites by status and combines status with search", () => {
    expect(filterSitesForDisplay(sites, { search: "", status: "active" }).map((item) => item.id)).toEqual([
      "site-2",
    ]);
    expect(filterSitesForDisplay(sites, { search: "farm", status: "draft" }).map((item) => item.id)).toEqual([
      "site-1",
    ]);
  });
});
