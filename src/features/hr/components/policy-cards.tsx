"use client";

/**
 * "Other leave" list: one card holding a row per leave type other than
 * Annual (Medical, Hospitalization, Paternity, Emergency, Unpaid, ...),
 * each with a slim available/pool usage bar colored by the shared
 * DOT_PALETTE. Upon-request types (entitlementDays === null) show "Upon
 * Request" and no bar — `computeBalance` returns `available: Infinity` for
 * those, which is a display convenience only (see leave-model.ts), never
 * rendered as a number.
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeBalance } from "../lib/leave-model";
import { balancePool } from "./entitlement-header";
import { DOT_PALETTE } from "./leave-history";
import type { LedgerEntry, LeaveRequestSummary, LeaveTypeInfo } from "../types";

type PolicyCardsProps = {
  types: LeaveTypeInfo[];
  ledger: LedgerEntry[];
  requests: LeaveRequestSummary[];
  year: number;
  asOfDate: string;
};

const BAR_PALETTE = DOT_PALETTE;

export function PolicyCards({ types, ledger, requests, year, asOfDate }: PolicyCardsProps) {
  const t = useTranslations("hr.policy");

  if (types.length === 0) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{t("otherLeaveTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {types.map((type) => {
            const balance = computeBalance(type, ledger, requests, year, asOfDate);
            const barColor = BAR_PALETTE[type.sort % BAR_PALETTE.length] ?? "bg-sky-500";
            const pool = balance.uponRequest ? 0 : balancePool(balance);
            const fraction = pool > 0 ? Math.min(Math.max(balance.available / pool, 0), 1) : 0;

            return (
              <div key={type.id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm">{type.name}</span>
                  {balance.uponRequest ? (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {t("uponRequest")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {t("availableCount", { n: balance.available })}
                    </span>
                  )}
                </div>
                {!balance.uponRequest && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-500", barColor)}
                      style={{ width: `${fraction * 100}%` }}
                    />
                  </div>
                )}
                {balance.pendingHeld > 0 && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    {t("booked", { n: balance.pendingHeld })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
