import { describe, expect, it } from "vitest";
import { filterFlocksForDisplay } from "@/features/flocks/flocks-list-model";
import type { Flock } from "@/features/flocks/types";

const baseFlock: Flock = {
  id: "11111111-1111-1111-1111-111111111111",
  organizationId: "22222222-2222-2222-2222-222222222222",
  siteId: "site-1",
  houseId: "house-1",
  productionProfileId: "profile-1",
  targetProfileVersionId: null,
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
  currentLiveBirds: 0,
  status: "draft",
  createdAt: "2026-06-26T00:00:00.000Z",
  updatedAt: "2026-06-26T00:00:00.000Z",
};

function flock(overrides: Partial<Flock>): Flock {
  return { ...baseFlock, ...overrides };
}

describe("filterFlocksForDisplay", () => {
  const flocks = [
    flock({ id: "flock-1", code: "L2026-01", name: "Layer cycle", productionType: "layer", status: "active" }),
    flock({ id: "flock-2", code: "B2026-01", name: "Broiler pilot", productionType: "broiler", siteId: "site-2", status: "ready" }),
    flock({ id: "flock-3", code: "Q2026-01", name: "Quarantine review", status: "restricted" }),
  ];

  it("searches flock code, name, source, and breed", () => {
    expect(filterFlocksForDisplay(flocks, { search: "broiler", status: "all", siteId: "all", productionType: "all" }).map((item) => item.id)).toEqual(["flock-2"]);
    expect(filterFlocksForDisplay(flocks, { search: "lohmann", status: "all", siteId: "all", productionType: "all" }).map((item) => item.id)).toEqual(["flock-1", "flock-2", "flock-3"]);
  });

  it("combines status, site, and production type filters", () => {
    expect(filterFlocksForDisplay(flocks, { search: "", status: "ready", siteId: "site-2", productionType: "broiler" }).map((item) => item.id)).toEqual(["flock-2"]);
    expect(filterFlocksForDisplay(flocks, { search: "", status: "restricted", siteId: "site-2", productionType: "all" })).toEqual([]);
  });
});
