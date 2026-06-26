import type {
  BiosecurityZone,
  Site,
  StructureStatus,
} from "./types";

export type ZoneRiskFilter = "all" | BiosecurityZone["riskClass"];
export type ZoneStatusFilter = "all" | StructureStatus;

export type ZoneListFilters = {
  search: string;
  siteId: "all" | string;
  risk: ZoneRiskFilter;
  status: ZoneStatusFilter;
};

export function filterZonesForDisplay(
  zones: BiosecurityZone[],
  sites: Site[],
  filters: ZoneListFilters,
): BiosecurityZone[] {
  const normalizedSearch = filters.search.trim().toLowerCase();
  const sitesById = new Map(sites.map((site) => [site.id, site]));

  return zones.filter((zone) => {
    const site = sitesById.get(zone.siteId);
    const matchesSite = filters.siteId === "all" || zone.siteId === filters.siteId;
    const matchesRisk = filters.risk === "all" || zone.riskClass === filters.risk;
    const matchesStatus = filters.status === "all" || zone.status === filters.status;
    const matchesSearch =
      normalizedSearch.length === 0 ||
      [zone.name, zone.code, site?.name, site?.code].some((value) =>
        value?.toLowerCase().includes(normalizedSearch),
      );

    return matchesSite && matchesRisk && matchesStatus && matchesSearch;
  });
}
