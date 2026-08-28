"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiCell, SalesViewModel } from "../sales-model";

function Delta({ cell }: { cell: KpiCell }) {
  const t = useTranslations("analytics.range");
  const format = useFormatter();
  if (cell.deltaPct === null) return null;
  const up = cell.deltaPct >= 0;
  return (
    <p className={`text-xs ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {format.number(Math.abs(cell.deltaPct) / 100, { style: "percent", maximumFractionDigits: 1 })}{" "}
      <span className="text-muted-foreground">{t("vsPrevious")}</span>
    </p>
  );
}

export function KpiRow({ vm }: { vm: SalesViewModel }) {
  const t = useTranslations("analytics.kpi");
  const format = useFormatter();
  const money = (n: number) => format.number(n, { style: "currency", currency: "MYR" });
  const cells: Array<{ key: string; label: string; cell: KpiCell; render: (n: number) => string }> = [
    { key: "revenue", label: t("revenue"), cell: vm.revenue, render: money },
    { key: "orders", label: t("orders"), cell: vm.orders, render: (n) => format.number(n) },
    { key: "kg", label: t("kg"), cell: vm.kg, render: (n) => format.number(n, { maximumFractionDigits: 1 }) },
    { key: "aov", label: t("aov"), cell: vm.aov, render: money },
    { key: "rmPerKg", label: t("rmPerKg"), cell: vm.rmPerKg, render: money },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {cells.map(({ key, label, cell, render }) => (
        <Card key={key}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Uniform size (not scaled up at sm/lg): the lg:grid-cols-5 row is
                just as width-constrained as the 2-col mobile grid once
                sidebar + gaps are subtracted, so a bigger breakpoint size
                would re-clip long "MYR 9,906.20"-style values there too. */}
            <p className="break-words text-lg font-semibold tabular-nums">
              {render(cell.value)}
            </p>
            <Delta cell={cell} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
