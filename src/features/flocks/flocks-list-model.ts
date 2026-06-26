import type { Flock, FlockStatus, ProductionType } from "./types";

export type FlockStatusFilter = "all" | FlockStatus;
export type FlockSiteFilter = "all" | string;
export type FlockProductionTypeFilter = "all" | ProductionType;

export function filterFlocksForDisplay(
  flocks: Flock[],
  filters: {
    search: string;
    status: FlockStatusFilter;
    siteId: FlockSiteFilter;
    productionType: FlockProductionTypeFilter;
  },
): Flock[] {
  const search = filters.search.trim().toLowerCase();

  return flocks.filter((flock) => {
    const matchesStatus = filters.status === "all" || flock.status === filters.status;
    const matchesSite = filters.siteId === "all" || flock.siteId === filters.siteId;
    const matchesProductionType =
      filters.productionType === "all" || flock.productionType === filters.productionType;
    const matchesSearch =
      search.length === 0 ||
      [flock.code, flock.name, flock.sourceName, flock.breedStrain].some((value) =>
        value.toLowerCase().includes(search),
      );

    return matchesStatus && matchesSite && matchesProductionType && matchesSearch;
  });
}
