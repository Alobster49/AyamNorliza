"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { sparklinePoints, type WatchRow } from "../lib/market-model";
import { DeltaBadge } from "./delta-badge";

const SPARK_W = 56;
const SPARK_H = 18;
const COLS = "grid-cols-[minmax(0,1fr)_48px_58px_58px] sm:grid-cols-[minmax(0,1fr)_48px_58px_58px_60px]";

type Props = {
  rows: WatchRow[];
  focusState: string;
  onFocus: (state: string) => void;
  disabled?: boolean;
};

/** Every state, dearest first. Clicking a row makes it the focus state. */
export function Watchlist({ rows, focusState, onFocus, disabled }: Props) {
  const t = useTranslations("market");
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t("watchlist.title", { count: rows.length })}
        </CardTitle>
        <span className="text-xs text-muted-foreground" data-slot="card-action">
          {t("watchlist.sorted")}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        <div
          className={cn(
            "grid items-center gap-2 px-2 pb-1 text-[11px] tracking-[0.04em] text-muted-foreground uppercase",
            COLS,
          )}
        >
          <span>{t("watchlist.state")}</span>
          <span className="text-right">{t("watchlist.last")}</span>
          <span className="text-right">{t("watchlist.d1")}</span>
          <span className="text-right">{t("watchlist.d7")}</span>
          <span className="hidden text-right sm:block">{t("watchlist.trend")}</span>
        </div>
        {rows.map((row, i) => {
          const focus = row.state === focusState;
          const points = sparklinePoints(row.spark, SPARK_W, SPARK_H);
          return (
            <button
              key={row.state}
              type="button"
              disabled={disabled}
              onClick={() => onFocus(row.state)}
              aria-pressed={focus}
              className={cn(
                "grid h-9 items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors hover:bg-muted/60 disabled:pointer-events-none",
                COLS,
                focus && "bg-muted",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
                <span className={cn("truncate", focus && "font-semibold")}>{row.state}</span>
              </span>
              <span className="text-right font-semibold tabular-nums">{row.last.toFixed(2)}</span>
              <span className="flex justify-end">
                <DeltaBadge delta={row.d1} />
              </span>
              <span className="flex justify-end">
                <DeltaBadge delta={row.d7} />
              </span>
              <span className="hidden justify-end sm:flex">
                {points ? (
                  <svg
                    width={SPARK_W}
                    height={SPARK_H}
                    viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                    aria-hidden
                    className={focus ? "text-(--market-standard)" : "text-muted-foreground"}
                  >
                    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
