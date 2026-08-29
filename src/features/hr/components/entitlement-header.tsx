"use client";

/**
 * Balance Ring hero: an SVG donut showing available / pool for the Annual
 * type, a one-line status sentence with chips, and the full CF + accrued −
 * taken = balance equation folded behind a "How it's calculated"
 * collapsible. The "as of" select recomputes everything client-side via the
 * same `computeBalance` the server trusts, so nothing here diverges from
 * what a fresh apply would see. `data-testid="annual-available"` on the ring
 * center is load-bearing for e2e.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

/** Pool the ring measures against: everything grantable as of the date. */
export function balancePool(balance: BalanceSummary): number {
  return Number((balance.carryForward + balance.accrued + balance.credits).toFixed(2));
}

function ringColorClass(fraction: number): string {
  if (fraction > 0.5) return "text-emerald-500";
  if (fraction >= 0.2) return "text-amber-500";
  return "text-red-500";
}

const RING_SIZE = 112;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function BalanceRing({ balance, daysLabel }: { balance: BalanceSummary; daysLabel: string }) {
  const pool = balancePool(balance);
  const fraction = pool > 0 ? Math.min(Math.max(balance.available / pool, 0), 1) : 0;

  return (
    <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden>
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          className="stroke-muted"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          className={cn("transition-[stroke-dashoffset] duration-500", ringColorClass(fraction))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold leading-none" data-testid="annual-available">
          {balance.available}
        </span>
        <span className="text-xs text-muted-foreground">{daysLabel}</span>
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}

function EquationStat({ label, value, sub }: { label: string; value: number; sub?: string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {sub?.map((line) => (
        <span key={line} className="text-xs text-muted-foreground">
          {line}
        </span>
      ))}
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
  const [detailsOpen, setDetailsOpen] = useState(false);

  const takenTotal = balance ? Number((balance.takenBase + balance.takenCarryForward).toFixed(2)) : 0;
  const pool = balance ? balancePool(balance) : 0;

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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
              <BalanceRing balance={balance} daysLabel={t("ofDays", { n: pool })} />
              <div className="flex min-w-0 flex-col items-center gap-2 sm:items-start">
                <p className="text-base font-semibold">{t("statusSentence", { n: balance.available })}</p>
                {balance.pendingHeld > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t("pendingNote", { n: balance.pendingHeld })}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
                  <Chip label={t("carryForward")} value={balance.carryForward} />
                  <Chip label={t("accrued")} value={balance.accrued} />
                  <Chip label={t("taken")} value={takenTotal} />
                  {balance.credits > 0 && <Chip label={t("credits")} value={balance.credits} />}
                </div>
              </div>
            </div>

            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                {t("howCalculated")}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3 flex flex-col items-stretch gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <EquationStat
                    label={t("carryForward")}
                    value={balance.carryForward}
                    sub={
                      balance.carryForwardExpiresOn
                        ? [t("carryForwardExpires", { date: formatDisplayDate(balance.carryForwardExpiresOn) })]
                        : undefined
                    }
                  />
                  <Operator symbol="+" />
                  <EquationStat label={t("accrued")} value={balance.accrued} />
                  {balance.credits > 0 && (
                    <>
                      <Operator symbol="+" />
                      <EquationStat label={t("credits")} value={balance.credits} />
                    </>
                  )}
                  <Operator symbol="-" />
                  <EquationStat
                    label={t("taken")}
                    value={takenTotal}
                    sub={[
                      t("takenAnnual", { n: balance.takenBase }),
                      t("takenCarryForward", { n: balance.takenCarryForward }),
                    ]}
                  />
                  {balance.pendingHeld > 0 && (
                    <>
                      <Operator symbol="-" />
                      <EquationStat label={t("pendingHeld")} value={balance.pendingHeld} />
                    </>
                  )}
                  <Operator symbol="=" />
                  <EquationStat label={t("currentBalance")} value={balance.available} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
