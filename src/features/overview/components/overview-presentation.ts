import type { OverviewDashboardSummary } from "../summary-model";

export const overviewLayoutClasses = {
  root: "flex w-full min-w-0 max-w-none flex-col gap-3 overflow-x-hidden",
  commandStrip:
    "grid min-w-0 gap-3 rounded-lg border bg-card/80 p-3 shadow-sm 2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]",
  commandStats: "grid min-w-0 gap-2 sm:grid-cols-3 2xl:grid-cols-1",
  kpiGrid: "grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6",
  kpiCard: "min-w-0 overflow-hidden rounded-lg shadow-none",
  contentGrid:
    "grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.7fr)]",
  chartFrame:
    "grid min-h-44 grid-cols-7 items-end gap-2 rounded-lg border bg-muted/20 p-3",
  priorityContent: "min-w-0 overflow-x-auto rounded-md border",
} as const;

export const overviewTrendSeries = [
  {
    key: "livability",
    label: "Livability",
    barClassName: "bg-emerald-400 dark:bg-emerald-300",
    legendClassName: "bg-emerald-400 dark:bg-emerald-300",
  },
  {
    key: "feedIndex",
    label: "Feed index",
    barClassName: "bg-amber-400 dark:bg-amber-300",
    legendClassName: "bg-amber-400 dark:bg-amber-300",
  },
  {
    key: "environment",
    label: "Environment",
    barClassName: "bg-sky-400 dark:bg-sky-300",
    legendClassName: "bg-sky-400 dark:bg-sky-300",
  },
] as const;

export type OverviewTrendSeries = (typeof overviewTrendSeries)[number];

export function getTrendValue(
  point: OverviewDashboardSummary["operations"]["trend"][number],
  series: OverviewTrendSeries,
): number {
  return point[series.key];
}
