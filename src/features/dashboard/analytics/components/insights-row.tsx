"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Label, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InsightsViewModel } from "../insights-model";

function LeakageChart({
  config,
  data,
  keys,
  centerValue,
  centerLabel,
}: {
  config: ChartConfig;
  data: Record<string, number>;
  keys: [string, string];
  centerValue: string;
  centerLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={config} className="mx-auto aspect-[2/1] w-full max-w-[300px]">
        <RadialBarChart data={[data]} cy="100%" startAngle={180} endAngle={0} innerRadius={70} outerRadius={120}>
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
              const cx = viewBox.cx ?? 0;
              const cy = viewBox.cy ?? 0;
              return (
                <text x={cx} y={cy} textAnchor="middle">
                  <tspan x={cx} y={cy - 28} className="fill-foreground text-xl font-bold">
                    {centerValue}
                  </tspan>
                  <tspan x={cx} y={cy - 8} className="fill-muted-foreground text-xs">
                    {centerLabel}
                  </tspan>
                </text>
              );
            }}
          />
        </PolarRadiusAxis>
          <RadialBar
            dataKey={keys[0]}
            stackId="a"
            cornerRadius={5}
            fill={`var(--color-${keys[0]})`}
            className="stroke-transparent stroke-2"
          />
          <RadialBar
            dataKey={keys[1]}
            stackId="a"
            minPointSize={8}
            cornerRadius={5}
            fill={`var(--color-${keys[1]})`}
            className="stroke-transparent stroke-2"
          />
        </RadialBarChart>
      </ChartContainer>
      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        {keys.map((key) => (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[2px]"
              style={{ backgroundColor: (config[key] as { color?: string })?.color }}
            />
            {config[key]?.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function WeightCard({ vm, earnedRm }: { vm: InsightsViewModel; earnedRm: number }) {
  const t = useTranslations("analytics.insights.weight");
  const format = useFormatter();
  const kg = (n: number) => format.number(n, { maximumFractionDigits: 1 });
  const money = (n: number) => format.number(n, { style: "currency", currency: "MYR" });
  const pct = (n: number) => format.number(n / 100, { style: "percent", maximumFractionDigits: 1 });
  const hasLeakage = vm.weight.lostKg > 0 || vm.weight.diffKg > 0;
  const rmConfig = {
    earned: { label: t("earned"), color: "var(--chart-1)" },
    lost: { label: t("lost"), color: "var(--chart-4)" },
  } satisfies ChartConfig;
  const kgConfig = {
    charged: { label: t("chargedKg"), color: "var(--chart-1)" },
    given: { label: t("givenKg"), color: "var(--chart-4)" },
  } satisfies ChartConfig;
  return (
    <Card>
      <Tabs defaultValue="rm" className="gap-(--card-spacing)">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
          {hasLeakage && (
            <CardAction>
              <TabsList>
                <TabsTrigger value="rm">{t("tabRm")}</TabsTrigger>
                <TabsTrigger value="kg">{t("tabKg")}</TabsTrigger>
              </TabsList>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {hasLeakage ? (
            <>
              <p className="text-sm">
                {vm.weight.lostRm > 0
                  ? t("lostSummary", {
                      rm: money(vm.weight.lostRm),
                      diff: kg(vm.weight.lostKg),
                      pct: pct(vm.weight.lossPct),
                    })
                  : t("summary", { diff: kg(vm.weight.diffKg), pct: pct(vm.weight.leakagePct) })}
              </p>
              <TabsContent value="rm">
                <LeakageChart
                  config={rmConfig}
                  data={{ earned: earnedRm, lost: vm.weight.lostRm }}
                  keys={["earned", "lost"]}
                  centerValue={money(earnedRm + vm.weight.lostRm)}
                  centerLabel={t("couldHaveEarned")}
                />
              </TabsContent>
              <TabsContent value="kg">
                <LeakageChart
                  config={kgConfig}
                  data={{ charged: vm.weight.finalKg, given: vm.weight.lostKg }}
                  keys={["charged", "given"]}
                  centerValue={`${kg(vm.weight.warehouseKg)} kg`}
                  centerLabel={t("deliveredKg")}
                />
              </TabsContent>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          )}
        </CardContent>
      </Tabs>
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

export function InsightsRow({
  vm,
  earnedRm,
}: {
  vm: InsightsViewModel;
  organizationSlug?: string;
  /**
   * Org-wide realized revenue for the range (e.g. `salesVm.revenue.value`).
   * `vm.pricing` is capped to the top 10 products by the RPC, so it
   * understates earned RM for orgs with more products — falls back to the
   * capped sum only when the real total isn't available (e.g. sales fetch
   * failed independently of insights).
   */
  earnedRm?: number;
}) {
  const t = useTranslations("analytics.insights");
  const resolvedEarnedRm = earnedRm ?? vm.pricing.reduce((sum, row) => sum + row.revenue, 0);
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{t("title")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <WeightCard vm={vm} earnedRm={resolvedEarnedRm} />
        <DeliveryCard vm={vm} />
      </div>
    </div>
  );
}
