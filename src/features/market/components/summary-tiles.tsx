"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/features/seller/lib/pricing";
import type { MarketSummary } from "../lib/market-model";

type Props = {
  summary: MarketSummary;
  premium: number | null;
  focusState: string;
  focusLast: number | null;
};

export function SummaryTiles({ summary, premium, focusState, focusLast }: Props) {
  const t = useTranslations("market");
  const tiles: { label: string; value: string; sub: string; tone?: string }[] = [
    {
      label: t("tiles.dearest"),
      value: summary.dearest ? formatPrice(summary.dearest.last) : "—",
      sub: summary.dearest?.state ?? "",
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: t("tiles.cheapest"),
      value: summary.cheapest ? formatPrice(summary.cheapest.last) : "—",
      sub: summary.cheapest?.state ?? "",
      tone: "text-red-600 dark:text-red-400",
    },
    {
      label: t("tiles.premium"),
      value: premium == null ? "—" : `${premium >= 0 ? "+" : "−"}${formatPrice(Math.abs(premium))}`,
      sub: t("tiles.premiumSub"),
      tone: "text-(--market-super)",
    },
    {
      label: t("tiles.spread"),
      value: summary.spread == null ? "—" : formatPrice(summary.spread),
      sub: t("tiles.spreadSub"),
    },
    {
      label: t("tiles.focus"),
      value: focusLast == null ? "—" : formatPrice(focusLast),
      sub: focusState,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <Card key={tile.label} size="sm" className="min-w-0">
          <CardContent className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{tile.label}</span>
            <span className={cn("truncate text-xl font-semibold tracking-tight tabular-nums", tile.tone)}>
              {tile.value}
            </span>
            <span className="truncate text-xs text-muted-foreground">{tile.sub}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
