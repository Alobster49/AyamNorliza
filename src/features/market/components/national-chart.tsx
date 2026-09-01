"use client";

import { useMemo } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatPrice } from "@/features/seller/lib/pricing";
import { deltaOver, type NationalPoint } from "../lib/market-model";
import { DeltaBadge } from "./delta-badge";

type Grade = 1 | 2;

type Props = {
  grade: Grade;
  gradeLabel: string;
  points: NationalPoint[];
};

type ChartPoint = NationalPoint & { band: [number, number] };

const SYNC_ID = "market-national";
const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

function gradeVar(grade: Grade) {
  return grade === 1 ? "var(--market-standard)" : "var(--market-super)";
}

/**
 * National median with the interquartile state band, and the premise count
 * as a separate bar strip underneath. Two charts, one x-axis each, synced —
 * never a second y-axis on the price plot.
 */
export function NationalChart({ grade, gradeLabel, points }: Props) {
  const t = useTranslations("market");
  const format = useFormatter();
  const color = gradeVar(grade);

  const data = useMemo<ChartPoint[]>(
    () => points.map((p) => ({ ...p, band: [p.q1, p.q3] })),
    [points],
  );
  const latest = points[points.length - 1];
  const d1 = deltaOver(points, 1);
  const d7 = deltaOver(points, 7);
  const d30 = deltaOver(points, 30);

  const config: ChartConfig = {
    median: { label: t("national.tooltipMedian"), color },
    band: { label: t("national.tooltipBand"), color },
    premises: { label: t("national.premisesAxis"), color: "var(--muted-foreground)" },
  };

  const dateTick = (d: string) =>
    format.dateTime(new Date(`${d}T00:00:00`), { month: "short", day: "numeric" });

  return (
    <Card className="min-w-0">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium text-muted-foreground">
              {t("national.title", { grade: gradeLabel })}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold tracking-tight">
                {latest ? formatPrice(latest.median) : t("noData")}
                {latest && (
                  <span className="text-base font-medium text-muted-foreground">{t("perKg")}</span>
                )}
              </span>
              <DeltaBadge delta={d1} className="text-sm" />
            </div>
          </div>
          <dl className="flex gap-5 text-xs text-muted-foreground">
            <Stat label={t("national.d7")}>
              <DeltaBadge delta={d7} />
            </Stat>
            <Stat label={t("national.d30")}>
              <DeltaBadge delta={d30} />
            </Stat>
            <Stat label={t("national.range")}>
              <span className="text-foreground tabular-nums">
                {latest ? `${latest.low.toFixed(2)}–${latest.high.toFixed(2)}` : "—"}
              </span>
            </Stat>
            <Stat label={t("national.premises")}>
              <span className="text-foreground tabular-nums">{latest?.premises ?? "—"}</span>
            </Stat>
          </dl>
        </div>

        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <ComposedChart data={data} margin={CHART_MARGIN} syncId={SYNC_ID}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={dateTick} minTickGap={32} hide />
            <YAxis
              domain={["auto", "auto"]}
              width={44}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)" }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as ChartPoint | undefined;
                if (!active || !point) return null;
                return (
                  <div className="grid min-w-40 gap-1 rounded-xl bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
                    <div className="text-muted-foreground">
                      {point.date} · {t("national.tooltipStates", { count: point.states })}
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span>{t("national.tooltipMedian")}</span>
                      <span className="font-semibold tabular-nums">{formatPrice(point.median)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-muted-foreground">
                      <span>{t("national.tooltipBand")}</span>
                      <span className="tabular-nums">
                        {point.q1.toFixed(2)}–{point.q3.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              dataKey="band"
              type="monotone"
              stroke="none"
              fill={color}
              fillOpacity={0.14}
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              dataKey="median"
              type="monotone"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
            {latest && (
              <ReferenceDot
                x={latest.date}
                y={latest.median}
                r={4}
                fill={color}
                stroke="var(--card)"
                strokeWidth={2}
              />
            )}
          </ComposedChart>
        </ChartContainer>

        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
            {t("national.premisesAxis")}
          </div>
          <ChartContainer config={config} className="aspect-auto h-16 w-full">
            <BarChart data={data} margin={CHART_MARGIN} syncId={SYNC_ID} barCategoryGap="20%">
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickFormatter={dateTick}
                minTickGap={32}
                tick={{ fontSize: 11 }}
              />
              <YAxis width={44} hide />
              <Bar dataKey="premises" fill="var(--muted-foreground)" fillOpacity={0.35} radius={2} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <Legend swatch={color} label={t("national.legendMedian")} />
          <Legend swatch={color} faded label={t("national.legendBand")} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <dt>{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function Legend({ swatch, faded = false, label }: { swatch: string; faded?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2 rounded-xs"
        style={{ width: faded ? 14 : 8, background: swatch, opacity: faded ? 0.3 : 1 }}
      />
      {label}
    </span>
  );
}
