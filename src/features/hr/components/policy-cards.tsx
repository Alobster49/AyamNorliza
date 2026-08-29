"use client";

/**
 * Screenshot 1's non-annual policy row: one card per leave type other than
 * Annual (Medical, Hospitalization, Paternity, Emergency, Unpaid, ...).
 * Upon-request types (entitlementDays === null) show "Upon Request" instead
 * of a number — `computeBalance` returns `available: Infinity` for those,
 * which is a display convenience only (see leave-model.ts), never rendered
 * as a number.
 */

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { computeBalance } from "../lib/leave-model";
import type { LedgerEntry, LeaveRequestSummary, LeaveTypeInfo } from "../types";

type PolicyCardsProps = {
  types: LeaveTypeInfo[];
  ledger: LedgerEntry[];
  requests: LeaveRequestSummary[];
  year: number;
  asOfDate: string;
};

export function PolicyCards({ types, ledger, requests, year, asOfDate }: PolicyCardsProps) {
  const t = useTranslations("hr.policy");

  if (types.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {types.map((type) => {
        const balance = computeBalance(type, ledger, requests, year, asOfDate);
        return (
          <Card key={type.id} size="sm">
            <CardHeader>
              <CardTitle className="text-sm">{type.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5">
              {balance.uponRequest ? (
                <span className="text-lg font-semibold">{t("uponRequest")}</span>
              ) : (
                <>
                  <span className="text-lg font-semibold">{balance.available}</span>
                  <span className="text-xs text-muted-foreground">{t("available")}</span>
                </>
              )}
              {balance.pendingHeld > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {t("booked", { n: balance.pendingHeld })}
                </span>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
