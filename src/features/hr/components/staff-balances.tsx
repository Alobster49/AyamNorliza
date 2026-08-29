"use client";

/**
 * Staff balances tab: one row per active member, one column per leave type,
 * each cell showing `available` (already computed server-side by
 * `computeBalance`, never re-derived here) with the unexpired
 * carry-forward-remaining amount as sub-text when it's greater than zero.
 * `SerializableBalance.available` is `null` for upon-request types (the
 * server's Infinity-safe encoding — see manage-actions.ts) so those cells
 * show the "Upon Request" label instead of a number.
 */

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StaffBalanceRow, SerializableBalance } from "../server/manage-actions";
import type { LeaveTypeInfo } from "../types";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cfRemaining(balance: SerializableBalance): number {
  return round2(Math.max(balance.carryForward - balance.takenCarryForward, 0));
}

type StaffBalancesProps = {
  staff: StaffBalanceRow[];
  types: LeaveTypeInfo[];
};

export function StaffBalances({ staff, types }: StaffBalancesProps) {
  const t = useTranslations("hr.manage.staffBalances");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("memberColumn")}</TableHead>
                  {types.map((type) => (
                    <TableHead key={type.id}>{type.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="font-medium">{row.displayName}</TableCell>
                    {types.map((type) => {
                      const balance = row.balances[type.id];
                      if (!balance) return <TableCell key={type.id}>—</TableCell>;
                      const remaining = cfRemaining(balance);
                      return (
                        <TableCell key={type.id}>
                          {balance.uponRequest || balance.available === null ? (
                            <span className="text-muted-foreground">{t("uponRequest")}</span>
                          ) : (
                            <div className="flex flex-col">
                              <span data-testid="staff-balance-available">{balance.available}</span>
                              {remaining > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {t("carryForwardRemaining", { n: remaining })}
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
