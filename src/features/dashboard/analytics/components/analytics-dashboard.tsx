"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  getDashboardInsights,
  getDashboardSales,
} from "@/features/dashboard/server/analytics-actions";
import type { MarketSuggestion } from "@/features/market/types";
import { bucketForRange, resolveRange, type RangePreset } from "../date-range";
import { buildSalesViewModel, type SalesPayload } from "../sales-model";
import { buildInsightsViewModel, type InsightsPayload } from "../insights-model";
import type { TodayPayload } from "../today-model";
import { KpiRow } from "./kpi-row";
import { RangePicker } from "./range-picker";
import { SectionError } from "./section-error";
import { RevenueChart } from "./revenue-chart";
import { FunnelCard } from "./funnel-card";
import { InsightsRow } from "./insights-row";
import { TodayStrip } from "./today-strip";
import { TopLists } from "./top-lists";

type Props = {
  organizationSlug: string;
  timeZone: string;
  initialRange: { from: string; to: string };
  initialSales: SalesPayload | null;
  today: TodayPayload | null;
  initialInsights: InsightsPayload | null;
  marketSuggestions: MarketSuggestion[];
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
  initialInsights,
  marketSuggestions,
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
  const [insightsState, setInsightsState] = useState<InsightsPayload | null>(initialInsights);
  const [insightsError, setInsightsError] = useState(initialInsights === null);
  const [isPending, startTransition] = useTransition();
  const requestSeq = useRef(0);

  const salesVm = useMemo(
    () =>
      salesState
        ? buildSalesViewModel(salesState.payload, salesState.from, salesState.to, salesState.bucket)
        : null,
    [salesState],
  );

  const insightsVm = useMemo(
    () => (insightsState ? buildInsightsViewModel(insightsState, marketSuggestions) : null),
    [insightsState, marketSuggestions],
  );

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    const bucket = bucketForRange(next.from, next.to);
    const seq = ++requestSeq.current;
    startTransition(async () => {
      const [salesResult, insightsResult] = await Promise.all([
        getDashboardSales(organizationSlug, next.from, next.to, bucket),
        getDashboardInsights(organizationSlug, next.from, next.to),
      ]);
      if (seq !== requestSeq.current) return; // superseded by a newer request
      if (salesResult.ok) {
        setSalesState({ payload: salesResult.data, from: next.from, to: next.to, bucket });
        setSalesError(false);
      } else {
        setSalesError(true);
      }
      if (insightsResult.ok) {
        setInsightsState(insightsResult.data);
        setInsightsError(false);
      } else {
        setInsightsError(true);
      }
    });
  }

  function onPreset(next: RangePreset) {
    setPreset(next);
    applyRange(resolveRange(next, timeZone));
  }

  function onCustom(next: { from: string; to: string }) {
    setPreset("custom");
    applyRange(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <RangePicker
          active={preset}
          range={range}
          onSelect={onPreset}
          onCustom={onCustom}
          disabled={isPending}
        />
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
      {insightsError || !insightsVm ? (
        <SectionError />
      ) : (
        <InsightsRow
          vm={insightsVm}
          organizationSlug={organizationSlug}
          earnedRm={salesVm?.revenue.value}
        />
      )}
      {!salesError && salesVm && <TopLists vm={salesVm} />}
      {today ? <TodayStrip payload={today} /> : <SectionError />}
    </div>
  );
}
