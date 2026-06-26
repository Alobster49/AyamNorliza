import type {
  ProductionProfile,
  ProductionType,
  TargetProfile,
  TargetProfileVersion,
} from "./types";

export type ProductionTypeFilter = "all" | ProductionType;
export type ProductionProfileStatusFilter = "all" | ProductionProfile["status"];
export type TargetProfileStatusFilter = "all" | TargetProfile["status"];

export type TargetProfileRow = TargetProfile & {
  versions: TargetProfileVersion[];
};

export function filterProductionProfilesForDisplay(
  profiles: ProductionProfile[],
  filters: { search: string; type: ProductionTypeFilter; status: ProductionProfileStatusFilter },
): ProductionProfile[] {
  const search = filters.search.trim().toLowerCase();

  return profiles.filter((profile) => {
    const matchesType = filters.type === "all" || profile.type === filters.type;
    const matchesStatus = filters.status === "all" || profile.status === filters.status;
    const matchesSearch =
      search.length === 0 ||
      [profile.name, profile.type, profile.status].some((value) => value.toLowerCase().includes(search));

    return matchesType && matchesStatus && matchesSearch;
  });
}

export function buildTargetProfileRows(
  profiles: TargetProfile[],
  versions: TargetProfileVersion[],
): TargetProfileRow[] {
  return profiles.map((profile) => ({
    ...profile,
    versions: versions.filter((version) => version.targetProfileId === profile.id),
  }));
}

export function filterTargetProfilesForDisplay(
  rows: TargetProfileRow[],
  filters: { search: string; productionType: ProductionTypeFilter; status: TargetProfileStatusFilter },
): TargetProfileRow[] {
  const search = filters.search.trim().toLowerCase();

  return rows.filter((profile) => {
    const matchesType = filters.productionType === "all" || profile.productionType === filters.productionType;
    const matchesStatus = filters.status === "all" || profile.status === filters.status;
    const matchesSearch =
      search.length === 0 ||
      [
        profile.profileFamily,
        profile.productionType,
        profile.breedStrain,
        profile.housingSystem,
        profile.region,
        ...profile.versions.map((version) => version.version),
      ].some((value) => value?.toLowerCase().includes(search));

    return matchesType && matchesStatus && matchesSearch;
  });
}
