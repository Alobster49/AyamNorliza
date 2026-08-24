"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalesViewModel } from "../sales-model";

export function FunnelCard({ vm }: { vm: SalesViewModel }) {
  const t = useTranslations("analytics");
  const tStatus = useTranslations("status.order");
  const format = useFormatter();
  const max = Math.max(1, ...vm.funnel.map((f) => f.count));
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium">{t("funnel.title")}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {t("funnel.cancellationRate")}{" "}
          {format.number(vm.cancellationRate, { style: "percent", maximumFractionDigits: 1 })}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {vm.funnel.map(({ status, count }) => (
          <div key={status} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{tStatus(status)}</span>
            <div className="h-4 flex-1 rounded bg-muted">
              <div
                className={`h-4 rounded ${status === "cancelled" ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs tabular-nums">{format.number(count)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
