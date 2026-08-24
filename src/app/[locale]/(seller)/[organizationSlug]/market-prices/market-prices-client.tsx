"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { applySuggestedPrice, setMarketState } from "@/features/market/server/actions";
import { priceDelta, sparklinePoints } from "@/features/market/lib/market-model";
import {
  MARKET_ITEMS,
  MARKET_STATES,
  marketItemLabel,
  type MarketPriceRow,
  type MarketSuggestion,
} from "@/features/market/types";
import { formatPrice } from "@/features/seller/lib/pricing";

const SPARK_W = 160;
const SPARK_H = 36;

type Props = {
  organizationId: string;
  organizationSlug: string;
  state: string;
  trend: MarketPriceRow[];
  suggestions: MarketSuggestion[];
};

export function MarketPricesClient({
  organizationId,
  organizationSlug,
  state,
  trend,
  suggestions,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("market");
  const [isPending, startTransition] = useTransition();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const byItem = useMemo(() => {
    const map = new Map<number, MarketPriceRow[]>();
    for (const row of trend) {
      const rows = map.get(row.item_code) ?? [];
      rows.push(row);
      map.set(row.item_code, rows);
    }
    return map;
  }, [trend]);

  const anyStale = suggestions.some((s) => s.stale);
  const latestDate = trend.at(-1)?.price_date;

  const handleStateChange = (next: string) => {
    startTransition(async () => {
      try {
        await setMarketState(organizationId, next, organizationSlug);
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

  const handleApply = (s: MarketSuggestion) => {
    if (s.suggested_price == null) return;
    setApplyingId(s.variant_id);
    startTransition(async () => {
      try {
        await applySuggestedPrice(s.variant_id, s.suggested_price!, organizationSlug);
        toast({ title: t("priceUpdated", { price: formatPrice(s.suggested_price!) }) });
        router.refresh();
      } catch (error) {
        toast({
          title: t("error"),
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      } finally {
        setApplyingId(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">
            {latestDate ? t("subtitleWithDate", { date: latestDate }) : t("subtitle")}
          </p>
        </div>
        <div className="w-56">
          <Select value={state} onValueChange={handleStateChange} disabled={isPending}>
            <SelectTrigger>
              <SelectValue />
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

      {anyStale && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("staleWarning")}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {MARKET_ITEMS.map((item) => {
          const rows = byItem.get(item.code) ?? [];
          const latest = rows.at(-1);
          const points = sparklinePoints(rows, SPARK_W, SPARK_H);
          return (
            <Card key={item.code}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {item.label} · {state}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-2xl font-semibold">
                    {latest ? `${formatPrice(latest.median_price)}/kg` : t("noData")}
                  </div>
                  {latest && (
                    <div className="text-xs text-muted-foreground">
                      {t("premisesCount", { count: latest.premise_count })} ·{" "}
                      {latest.price_date}
                    </div>
                  )}
                </div>
                {points && (
                  <svg
                    width={SPARK_W}
                    height={SPARK_H}
                    viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                    className="text-primary"
                    aria-hidden
                  >
                    <polyline
                      points={points}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("priceSuggestionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSuggestions")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">{t("table.variant")}</th>
                    <th className="py-2 font-medium">{t("table.benchmark")}</th>
                    <th className="py-2 font-medium">{t("table.marketBase")}</th>
                    <th className="py-2 font-medium">{t("table.current")}</th>
                    <th className="py-2 font-medium">{t("table.suggested")}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => {
                    const delta =
                      s.suggested_price != null
                        ? priceDelta(s.current_price, s.suggested_price)
                        : null;
                    const matches =
                      s.suggested_price != null && delta !== null && delta.amount === 0;
                    return (
                      <tr key={s.variant_id} className="border-t">
                        <td className="py-2">
                          {s.product_name} — {s.variant_name}
                        </td>
                        <td className="py-2">{marketItemLabel(s.market_item_code)}</td>
                        <td className="py-2">
                          {s.market_base != null ? formatPrice(s.market_base) : t("noData")}
                        </td>
                        <td className="py-2">{formatPrice(s.current_price)}</td>
                        <td className="py-2">
                          {s.suggested_price != null ? (
                            <span>
                              {formatPrice(s.suggested_price)}{" "}
                              {delta && delta.amount !== 0 && (
                                <span
                                  className={
                                    delta.amount > 0 ? "text-emerald-600" : "text-red-600"
                                  }
                                >
                                  ({delta.amount > 0 ? "+" : ""}
                                  {delta.pct}%)
                                </span>
                              )}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            disabled={
                              s.suggested_price == null || matches || applyingId === s.variant_id
                            }
                            onClick={() => handleApply(s)}
                          >
                            {matches ? t("upToDate") : t("apply")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("source")}</p>
    </div>
  );
}
