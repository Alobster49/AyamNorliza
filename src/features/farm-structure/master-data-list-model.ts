import type {
  CodeSet,
  CodeValue,
} from "./types";

export type CodeSetStatusFilter = "all" | CodeSet["status"];
export type CodeValueStatusFilter = "all" | CodeValue["status"];

export function filterCodeSetsForDisplay(
  codeSets: CodeSet[],
  filters: { search: string; setStatus: CodeSetStatusFilter; valueStatus: CodeValueStatusFilter },
): CodeSet[] {
  const search = filters.search.trim().toLowerCase();

  return codeSets.filter((set) => {
    const matchesSetStatus = filters.setStatus === "all" || set.status === filters.setStatus;
    const matchesValueStatus =
      filters.valueStatus === "all" || set.values.some((value) => value.status === filters.valueStatus);
    const matchesSearch =
      search.length === 0 ||
      [set.key, set.name, set.description, ...set.values.flatMap((value) => [value.code, value.label])].some(
        (value) => value?.toLowerCase().includes(search),
      );

    return matchesSetStatus && matchesValueStatus && matchesSearch;
  });
}
