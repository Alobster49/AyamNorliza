"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildTodayViewModel, type TodayPayload } from "../today-model";

export function TodayStrip({ payload }: { payload: TodayPayload }) {
  const t = useTranslations("analytics.today");
  const tRun = useTranslations("status.run");
  const vm = buildTodayViewModel(payload);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {vm.alerts.length > 0 && (
          <div className="flex flex-col gap-1">
            {vm.alerts.map((alert) => (
              <p key={alert.kind} className="flex items-center gap-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t(`alerts.${alert.kind}`, { count: alert.count })}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          <span>{t("tasksPending")}: <strong className="tabular-nums">{vm.tasksPending}</strong></span>
          <span>{t("tasksDoneToday")}: <strong className="tabular-nums">{vm.tasksDoneToday}</strong></span>
        </div>
        {vm.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRuns")}</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {vm.runs.map((run) => (
              <div key={run.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{run.truckName} ({run.truckCode})</span>
                  <Badge variant="outline">{tRun(run.status)}</Badge>
                </div>
                <div className="mt-1 h-2 rounded bg-muted">
                  <div className="h-2 rounded bg-primary" style={{ width: `${run.progressPct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {run.delivered}/{run.ordersTotal}
                  {run.failed > 0 ? ` · ${t("failedStops", { count: run.failed })}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
