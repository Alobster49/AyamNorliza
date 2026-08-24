"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SeriesPoint } from "../sales-model";

export function RevenueChart({ series }: { series: SeriesPoint[] }) {
  const t = useTranslations("analytics");
  const format = useFormatter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("chart.title")}</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11 }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              width={56}
              tickFormatter={(v: number) => format.number(v, { notation: "compact" })}
            />
            <Tooltip
              formatter={(value) => {
                const num = typeof value === "number" ? value : 0;
                return [
                  format.number(num, { style: "currency", currency: "MYR" }),
                  t("kpi.revenue"),
                ];
              }}
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                color: "var(--popover-foreground)",
              }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              itemStyle={{ color: "var(--popover-foreground)" }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--primary)"
              fill="var(--primary)"
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
