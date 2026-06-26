import type { Site } from "./types";

export type SiteStatusFilter = "all" | Site["status"];

export function filterSitesForDisplay(
  sites: Site[],
  filters: { search: string; status: SiteStatusFilter },
): Site[] {
  const search = filters.search.trim().toLowerCase();

  return sites.filter((site) => {
    const matchesStatus = filters.status === "all" || site.status === filters.status;
    const matchesSearch =
      search.length === 0 ||
      [site.name, site.code, site.timeZone, site.currencyCode].some((value) =>
        value.toLowerCase().includes(search),
      );

    return matchesStatus && matchesSearch;
  });
}
