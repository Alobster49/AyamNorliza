import type {
  BiosecurityZone,
  Site,
  StorageLocation,
  StructureStatus,
} from "./types";

export type StorageTypeFilter = "all" | StorageLocation["locationType"];
export type StorageRestrictedFilter = "all" | "restricted" | "standard";
export type StorageStatusFilter = "all" | StructureStatus;

export type StorageListFilters = {
  search: string;
  siteId: "all" | string;
  zoneId: "all" | string;
  type: StorageTypeFilter;
  restricted: StorageRestrictedFilter;
  status: StorageStatusFilter;
};

export function filterStorageForDisplay(
  storageLocations: StorageLocation[],
  sites: Site[],
  zones: BiosecurityZone[],
  filters: StorageListFilters,
): StorageLocation[] {
  const search = filters.search.trim().toLowerCase();
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const zonesById = new Map(zones.map((zone) => [zone.id, zone]));

  return storageLocations.filter((location) => {
    const site = sitesById.get(location.siteId);
    const zone = location.zoneId ? zonesById.get(location.zoneId) : null;
    const matchesSite = filters.siteId === "all" || location.siteId === filters.siteId;
    const matchesZone = filters.zoneId === "all" || location.zoneId === filters.zoneId;
    const matchesType = filters.type === "all" || location.locationType === filters.type;
    const matchesRestricted =
      filters.restricted === "all" ||
      (filters.restricted === "restricted" ? location.restricted : !location.restricted);
    const matchesStatus = filters.status === "all" || location.status === filters.status;
    const matchesSearch =
      search.length === 0 ||
      [location.name, location.code, location.locationType, site?.name, site?.code, zone?.code].some((value) =>
        value?.toLowerCase().includes(search),
      );

    return matchesSite && matchesZone && matchesType && matchesRestricted && matchesStatus && matchesSearch;
  });
}
