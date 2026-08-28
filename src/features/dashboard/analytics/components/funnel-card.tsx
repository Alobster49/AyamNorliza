"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { SalesViewModel } from "../sales-model";

/** Above this share of orders, the cancellation badge turns into a warning. */
const CANCELLATION_ALERT = 0.05;

export function FunnelCard({ vm }: { vm: SalesViewModel }) {
  const t = useTranslations("analytics");
  const tStatus = useTranslations("status.order");
  const format = useFormatter();
  const max = Math.max(1, ...vm.funnel.map((f) => f.count));
  const total = vm.funnel.reduce((sum, f) => sum + f.count, 0);
  const pct = (n: number, digits = 0) =>
    format.number(n, { style: "percent", maximumFractionDigits: digits });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("funnel.title")}</CardTitle>
        <CardAction>
          <Badge variant={vm.cancellationRate > CANCELLATION_ALERT ? "destructive" : "secondary"}>
            {t("funnel.cancellationRate")} {pct(vm.cancellationRate, 1)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {vm.funnel.map(({ status, count }) => (
          <div
            key={status}
            className={cn("flex items-center gap-3", count === 0 && "opacity-50")}
          >
            <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
              {tStatus(status)}
            </span>
            <Progress
              value={(count / max) * 100}
              className={cn(
                "h-2 flex-1",
                status === "cancelled" && "[&_[data-slot=progress-indicator]]:bg-destructive",
              )}
            />
            <span className="w-8 text-right text-xs font-medium tabular-nums">
              {format.number(count)}
            </span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {total > 0 ? pct(count / total) : "—"}
            </span>
          </div>
        ))}
      </CardContent>
      <CardFooter className="mt-auto justify-between border-t text-xs">
        <span className="text-muted-foreground">{t("funnel.total")}</span>
        <span className="font-medium tabular-nums">{format.number(total)}</span>
      </CardFooter>
    </Card>
  );
}
