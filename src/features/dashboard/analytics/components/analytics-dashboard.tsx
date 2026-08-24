"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { getDashboardSales } from "@/features/dashboard/server/analytics-actions";
import { bucketForRange, resolveRange, type RangePreset } from "../date-range";
import { buildSalesViewModel, type SalesPayload } from "../sales-model";
import { KpiRow } from "./kpi-row";
import { RangePicker } from "./range-picker";
import { SectionError } from "./section-error";

type Props = {
  organizationSlug: string;
  timeZone: string;
  initialRange: { from: string; to: string };
  initialSales: SalesPayload | null;
};

export function AnalyticsDashboard({ organizationSlug, timeZone, initialRange, initialSales }: Props) {
  const t = useTranslations("analytics");
  const [preset, setPreset] = useState<RangePreset | "custom">("30d");
  const [range, setRange] = useState(initialRange);
  const [sales, setSales] = useState<SalesPayload | null>(initialSales);
  const [salesError, setSalesError] = useState(initialSales === null);
  const [isPending, startTransition] = useTransition();

  const bucket = bucketForRange(range.from, range.to);
  const salesVm = useMemo(
    () => (sales ? buildSalesViewModel(sales, range.from, range.to, bucket) : null),
    [sales, range, bucket],
  );

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    startTransition(async () => {
      const result = await getDashboardSales(
        organizationSlug, next.from, next.to, bucketForRange(next.from, next.to),
      );
      if (result.ok) {
        setSales(result.data);
        setSalesError(false);
      } else {
        setSalesError(true);
      }
    });
  }

  function onPreset(next: RangePreset) {
    setPreset(next);
    applyRange(resolveRange(next, timeZone));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <RangePicker active={preset} onSelect={onPreset} disabled={isPending} />
      </div>
      {salesVm ? <KpiRow vm={salesVm} /> : <SectionError />}
    </div>
  );
}
