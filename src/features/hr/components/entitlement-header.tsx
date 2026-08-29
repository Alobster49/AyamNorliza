"use client";

/**
 * Screenshot 1: the equation card — Carry Forward (+ expiry line) plus
 * Annual Leave Accrued minus Leave Taken (split into the CF-first-used
 * base/carry-forward lines from `breakdown`) equals Current Leave Balance.
 * The "as of" select recomputes the whole equation client-side via the
 * same `computeBalance` the server trusts, so nothing here diverges from
 * what a fresh apply would see.
 */

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDisplayDate } from "../lib/date-format";
import type { BalanceSummary, LeaveTypeInfo } from "../types";

export type AsOfMode = "today" | "end_of_year";

type EntitlementHeaderProps = {
  annualType: LeaveTypeInfo | null;
  balance: BalanceSummary | null;
  asOf: AsOfMode;
  onAsOfChange: (mode: AsOfMode) => void;
};

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function Operator({ symbol }: { symbol: string }) {
  return (
    <span aria-hidden className="hidden text-xl text-muted-foreground sm:block">
      {symbol}
    </span>
  );
}

export function EntitlementHeader({ annualType, balance, asOf, onAsOfChange }: EntitlementHeaderProps) {
  const t = useTranslations("hr.myLeave");
  const takenTotal = balance ? Number((balance.takenBase + balance.takenCarryForward).toFixed(2)) : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{annualType?.name ?? t("annualFallback")}</CardTitle>
        <Select value={asOf} onValueChange={(value) => onAsOfChange(value as AsOfMode)}>
          <SelectTrigger size="sm" aria-label={t("asOfLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">{t("asOfToday")}</SelectItem>
            <SelectItem value="end_of_year">{t("asOfEndOfYear")}</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {!balance ? (
          <p className="text-sm text-muted-foreground">{t("noData")}</p>
        ) : (
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Stat
              label={t("carryForward")}
              value={balance.carryForward}
              sub={
                balance.carryForwardExpiresOn
                  ? t("carryForwardExpires", { date: formatDisplayDate(balance.carryForwardExpiresOn) })
                  : undefined
              }
            />
            <Operator symbol="+" />
            <Stat label={t("accrued")} value={balance.accrued} />
            <Operator symbol="-" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t("taken")}</span>
              <span className="text-lg font-semibold">{takenTotal}</span>
              <span className="text-xs text-muted-foreground">{t("takenAnnual", { n: balance.takenBase })}</span>
              <span className="text-xs text-muted-foreground">
                {t("takenCarryForward", { n: balance.takenCarryForward })}
              </span>
            </div>
            <Operator symbol="=" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t("currentBalance")}</span>
              <span className="text-3xl font-semibold" data-testid="annual-available">
                {balance.available}
              </span>
              <span className="text-xs text-muted-foreground">{t("days")}</span>
              {balance.pendingHeld > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {t("pendingNote", { n: balance.pendingHeld })}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
