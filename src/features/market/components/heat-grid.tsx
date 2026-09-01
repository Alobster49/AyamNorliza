"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { heatBin, type HeatGrid as HeatGridModel } from "../lib/market-model";

/** Mix of the grade colour into the card surface, one entry per quantile bin. */
const BIN_MIX = [8, 20, 32, 44, 56, 70, 85, 100];

type Props = {
  grid: HeatGridModel;
  grade: 1 | 2;
  focusState: string;
};

/**
 * Every state × the last N days, coloured by quantile rank so the peninsula
 * rows keep contrast next to Sabah and Labuan. Scrolls sideways inside the
 * card; the shell is overflow-x-hidden, so the scroll container must be here.
 */
export function HeatGrid({ grid, grade, focusState }: Props) {
  const t = useTranslations("market");
  const format = useFormatter();
  const hue = grade === 1 ? "var(--market-standard)" : "var(--market-super)";
  const cellColor = (value: number) =>
    `color-mix(in oklch, ${hue} ${BIN_MIX[heatBin(value, grid.thresholds)] ?? 100}%, var(--card))`;
  const cols = `104px repeat(${grid.dates.length}, minmax(22px, 1fr)) 52px`;

  if (grid.dates.length === 0) return null;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t("heat.title", { count: grid.dates.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex min-w-[520px] flex-col gap-0.5">
            <div className="grid gap-0.5 text-[10px] text-muted-foreground" style={{ gridTemplateColumns: cols }}>
              <span />
              {grid.dates.map((d, i) => (
                <span key={d} className="text-center tabular-nums">
                  {i % 2 === 0 ? format.dateTime(new Date(`${d}T00:00:00`), { day: "numeric" }) : ""}
                </span>
              ))}
              <span className="text-right">{t("heat.last")}</span>
            </div>
            {grid.rows.map((row) => {
              const focus = row.state === focusState;
              return (
                <div
                  key={row.state}
                  className="grid h-[22px] items-center gap-0.5"
                  style={{ gridTemplateColumns: cols }}
                >
                  <span
                    className={cn(
                      "truncate pr-2 text-xs",
                      focus ? "font-semibold" : "text-foreground/90",
                    )}
                  >
                    {row.state}
                  </span>
                  {row.cells.map((value, i) => (
                    <span
                      key={grid.dates[i]}
                      className="h-5 rounded-[4px]"
                      title={value == null ? undefined : `${row.state} · ${grid.dates[i]} · ${value.toFixed(2)}`}
                      style={{ background: value == null ? "transparent" : cellColor(value) }}
                    />
                  ))}
                  <span className="text-right text-xs font-semibold tabular-nums">{row.last.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="m-0 text-[11px] text-muted-foreground">{t("heat.caption")}</p>
      </CardContent>
    </Card>
  );
}
