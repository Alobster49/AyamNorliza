"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { getDashboardSales } from "@/features/dashboard/server/analytics-actions";
import { bucketForRange, resolveRange, type RangePreset } from "../date-range";
import { buildSalesViewModel, type SalesPayload } from "../sales-model";
import type { TodayPayload } from "../today-model";
import type { AdminSummary } from "../admin-summary-model";
import { KpiRow } from "./kpi-row";
import { RangePicker } from "./range-picker";
import { SectionError } from "./section-error";
import { RevenueChart } from "./revenue-chart";
import { FunnelCard } from "./funnel-card";
import { TodayStrip } from "./today-strip";
import { AdminPanel } from "./admin-panel";

type Props = {
  organizationSlug: string;
  timeZone: string;
  initialRange: { from: string; to: string };
  initialSales: SalesPayload | null;
  today: TodayPayload | null;
  adminSummary: AdminSummary | null;
};

/** Sales payload bound to the exact range/bucket it was fetched for, so a stale render can never mix old data with a new range. */
type SalesState = {
  payload: SalesPayload;
  from: string;
  to: string;
  bucket: "day" | "week";
};

export function AnalyticsDashboard({
  organizationSlug,
  timeZone,
  initialRange,
  initialSales,
  today,
  adminSummary,
}: Props) {
  const t = useTranslations("analytics");
  const [preset, setPreset] = useState<RangePreset | "custom">("30d");
  const [range, setRange] = useState(initialRange);
  const [salesState, setSalesState] = useState<SalesState | null>(
    initialSales
      ? {
          payload: initialSales,
          from: initialRange.from,
          to: initialRange.to,
          bucket: bucketForRange(initialRange.from, initialRange.to),
        }
      : null,
  );
  const [salesError, setSalesError] = useState(initialSales === null);
  const [isPending, startTransition] = useTransition();
  const requestSeq = useRef(0);

  const salesVm = useMemo(
    () =>
      salesState
        ? buildSalesViewModel(salesState.payload, salesState.from, salesState.to, salesState.bucket)
        : null,
    [salesState],
  );

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    const bucket = bucketForRange(next.from, next.to);
    const seq = ++requestSeq.current;
    startTransition(async () => {
      const result = await getDashboardSales(organizationSlug, next.from, next.to, bucket);
      if (seq !== requestSeq.current) return; // superseded by a newer request
      if (result.ok) {
        setSalesState({ payload: result.data, from: next.from, to: next.to, bucket });
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
      {salesError || !salesVm ? (
        <SectionError />
      ) : (
        <>
          <KpiRow vm={salesVm} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RevenueChart series={salesVm.series} />
            <FunnelCard vm={salesVm} />
          </div>
        </>
      )}
      {today ? <TodayStrip payload={today} /> : <SectionError />}
      {adminSummary && <AdminPanel summary={adminSummary} organizationSlug={organizationSlug} />}
    </div>
  );
}
