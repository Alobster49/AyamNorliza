"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { setMarketState } from "@/features/market/server/actions";
import {
  gradePremium,
  heatGrid,
  nationalSeries,
  seriesByState,
  summarize,
  watchlist,
} from "@/features/market/lib/market-model";
import { MARKET_ITEMS, MARKET_STATES, type MarketPriceRow } from "@/features/market/types";
import { HeatGrid } from "@/features/market/components/heat-grid";
import { NationalChart } from "@/features/market/components/national-chart";
import { SummaryTiles } from "@/features/market/components/summary-tiles";
import { TickerTape } from "@/features/market/components/ticker-tape";
import { Watchlist } from "@/features/market/components/watchlist";

type Grade = 1 | 2;

type Props = {
  organizationSlug: string;
  /** The org's saved state — a highlight, not a filter. */
  focusState: string;
  /** Every tracked state and grade for the trailing window. */
  trend: MarketPriceRow[];
};

export function MarketPricesClient({ organizationSlug, focusState, trend }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("market");
  const [isPending, startTransition] = useTransition();
  const [grade, setGrade] = useState<Grade>(1);

  const model = useMemo(() => {
    const standard = seriesByState(trend, 1);
    const superGrade = seriesByState(trend, 2);
    const byState = grade === 1 ? standard : superGrade;
    return {
      byState,
      rows: watchlist(byState),
      national: nationalSeries(byState),
      heat: heatGrid(byState),
      summary: summarize(byState),
      premium: gradePremium(nationalSeries(standard), nationalSeries(superGrade)),
    };
  }, [trend, grade]);

  const gradeLabel = t(grade === 1 ? "grade.standard" : "grade.super");
  const focusLast = model.rows.find((r) => r.state === focusState)?.last ?? null;
  const latestDate = model.summary.latestDate;

  const handleFocusChange = (next: string) => {
    if (next === focusState) return;
    startTransition(async () => {
      try {
        await setMarketState(organizationSlug, next);
        router.refresh();
      } catch (error) {
        toast({
          title: t("error"),
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">
            {latestDate ? t("subtitleWithDate", { date: latestDate }) : t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={String(grade)} onValueChange={(v) => setGrade(Number(v) as Grade)}>
            <TabsList>
              {MARKET_ITEMS.map((item) => (
                <TabsTrigger key={item.code} value={String(item.code)} className="px-3">
                  {t(item.code === 1 ? "grade.standard" : "grade.super")}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Select value={focusState} onValueChange={handleFocusChange} disabled={isPending}>
            <SelectTrigger className="w-52">
              <SelectValue>{t("focus", { state: focusState })}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MARKET_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {model.rows.length === 0 ? (
        <p className="rounded-xl bg-card p-6 text-sm text-muted-foreground ring-1 ring-foreground/5 dark:ring-foreground/10">
          {t("empty")}
        </p>
      ) : (
        <>
          <TickerTape rows={model.rows} />

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
            <NationalChart grade={grade} gradeLabel={gradeLabel} points={model.national} />
            <Watchlist
              rows={model.rows}
              focusState={focusState}
              onFocus={handleFocusChange}
              disabled={isPending}
            />
          </div>

          <HeatGrid grid={model.heat} grade={grade} focusState={focusState} />

          <SummaryTiles
            summary={model.summary}
            premium={model.premium}
            focusState={focusState}
            focusLast={focusLast}
          />
        </>
      )}

      <p className="text-xs text-muted-foreground">{t("source")}</p>
    </div>
  );
}
