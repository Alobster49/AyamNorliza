import type { QrIdentifier } from "./types";

export type LabelEntityTypeFilter = "all" | QrIdentifier["entityType"];
export type LabelSymbologyFilter = "all" | QrIdentifier["symbology"];
export type LabelStatusFilter = "all" | QrIdentifier["status"];

export function filterLabelsForDisplay(
  identifiers: QrIdentifier[],
  filters: {
    search: string;
    entityType: LabelEntityTypeFilter;
    symbology: LabelSymbologyFilter;
    status: LabelStatusFilter;
  },
): QrIdentifier[] {
  const search = filters.search.trim().toLowerCase();

  return identifiers.filter((identifier) => {
    const matchesType = filters.entityType === "all" || identifier.entityType === filters.entityType;
    const matchesSymbology = filters.symbology === "all" || identifier.symbology === filters.symbology;
    const matchesStatus = filters.status === "all" || identifier.status === filters.status;
    const matchesSearch =
      search.length === 0 ||
      [identifier.printableCode, identifier.entityType, identifier.entityId].some((value) =>
        value.toLowerCase().includes(search),
      );

    return matchesType && matchesSymbology && matchesStatus && matchesSearch;
  });
}
