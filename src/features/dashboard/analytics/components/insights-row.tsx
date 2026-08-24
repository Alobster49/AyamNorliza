"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InsightsViewModel } from "../insights-model";

function PricingCard({ vm }: { vm: InsightsViewModel }) {
  const t = useTranslations("analytics.insights.pricing");
  const format = useFormatter();
  const money = (n: number) => format.number(n, { style: "currency", currency: "MYR" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("product")}</TableHead>
              <TableHead className="text-right">{t("realized")}</TableHead>
              <TableHead className="text-right">{t("market")}</TableHead>
              <TableHead className="text-right">{t("gap")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vm.pricing.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.realizedPerKg !== null ? money(row.realizedPerKg) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.marketBase !== null ? money(row.marketBase) : "—"}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    row.gapPct === null
                      ? "text-muted-foreground"
                      : row.gapPct < 0
                        ? "text-red-600"
                        : "text-emerald-600"
                  }`}
                >
                  {row.gapPct !== null ? (
                    format.number(row.gapPct / 100, { style: "percent", maximumFractionDigits: 1 })
                  ) : (
                    <span className="text-muted-foreground">{t("noMarket")}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WeightCard({ vm }: { vm: InsightsViewModel }) {
  const t = useTranslations("analytics.insights.weight");
  const format = useFormatter();
  const kg = (n: number) => format.number(n, { maximumFractionDigits: 1 });
  const hasLeakage = vm.weight.diffKg > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {hasLeakage ? (
          <>
            <p className="text-sm">
              {t("summary", {
                diff: kg(vm.weight.diffKg),
                pct: format.number(vm.weight.leakagePct / 100, { style: "percent", maximumFractionDigits: 1 }),
              })}
            </p>
            <ul className="flex flex-col gap-1">
              {vm.weight.byProduct.map((p) => (
                <li key={p.name} className="flex items-center justify-between text-sm">
                  <span>{p.name}</span>
                  <span className="tabular-nums text-muted-foreground">{kg(p.diffKg)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function RetentionCard({ vm }: { vm: InsightsViewModel }) {
  const t = useTranslations("analytics.insights.retention");
  const format = useFormatter();
  const money = (n: number) => format.number(n, { style: "currency", currency: "MYR" });
  const stats = [
    { key: "active", label: t("active"), value: vm.retention.active },
    { key: "new", label: t("new"), value: vm.retention.newCustomers },
    { key: "returning", label: t("returning"), value: vm.retention.returning },
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          {stats.map((s) => (
            <div key={s.key} className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold tabular-nums">{format.number(s.value)}</p>
            </div>
          ))}
        </div>
        <p className="text-xs font-medium text-muted-foreground">{t("silentTitle")}</p>
        {vm.retention.silent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noneSilent")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {vm.retention.silent.map((c) => (
              <li key={c.name} className="flex items-center justify-between text-sm">
                <span>{c.name}</span>
                <span className="text-muted-foreground">
                  {format.dateTime(new Date(c.lastOrderDate), { dateStyle: "medium" })} · {money(c.lifetimeRevenue)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryCard({ vm }: { vm: InsightsViewModel }) {
  const t = useTranslations("analytics.insights.delivery");
  const format = useFormatter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{t("failureRate")}</p>
            <p className="text-lg font-semibold tabular-nums">
              {format.number(vm.delivery.failureRate, { style: "percent", maximumFractionDigits: 1 })}
            </p>
            <p className="text-xs text-muted-foreground">{t("attempts", { count: vm.delivery.attempts })}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("slotFill")}</p>
            <p className="text-lg font-semibold tabular-nums">
              {vm.delivery.slotFillPct !== null
                ? format.number(vm.delivery.slotFillPct / 100, { style: "percent", maximumFractionDigits: 1 })
                : "—"}
            </p>
          </div>
        </div>
        {vm.delivery.byZone.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{t("byZone")}</p>
            <ul className="flex flex-col gap-1">
              {vm.delivery.byZone.map((z) => (
                <li key={z.zone} className="flex items-center justify-between text-sm">
                  <span>{z.zone}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {z.failed}/{z.total}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function InsightsRow({ vm }: { vm: InsightsViewModel }) {
  const t = useTranslations("analytics.insights");
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{t("title")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <PricingCard vm={vm} />
        <WeightCard vm={vm} />
        <RetentionCard vm={vm} />
        <DeliveryCard vm={vm} />
      </div>
    </div>
  );
}
