export type TodayRun = {
  id: string;
  truckName: string;
  truckCode: string;
  status: "planned" | "departed" | "completed";
  ordersTotal: number;
  delivered: number;
  failed: number;
};

export type TodayPayload = {
  date: string;
  runs: TodayRun[];
  tasksPending: number;
  tasksDoneToday: number;
  ordersWithoutRun: number;
  marketPriceDate: string | null;
  marketStale: boolean;
};

export type TodayAlert = { kind: "ordersWithoutRun" | "marketStale"; count: number };

export type TodayViewModel = {
  date: string;
  runs: Array<TodayRun & { progressPct: number }>;
  tasksPending: number;
  tasksDoneToday: number;
  alerts: TodayAlert[];
};

export function buildTodayViewModel(payload: TodayPayload): TodayViewModel {
  const alerts: TodayAlert[] = [];
  if (payload.ordersWithoutRun > 0) {
    alerts.push({ kind: "ordersWithoutRun", count: payload.ordersWithoutRun });
  }
  if (payload.marketStale) alerts.push({ kind: "marketStale", count: 0 });
  return {
    date: payload.date,
    runs: payload.runs.map((run) => ({
      ...run,
      progressPct: run.ordersTotal > 0 ? Math.round((run.delivered / run.ordersTotal) * 100) : 0,
    })),
    tasksPending: payload.tasksPending,
    tasksDoneToday: payload.tasksDoneToday,
    alerts,
  };
}
