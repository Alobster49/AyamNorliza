"use client";

/**
 * Top-level My Leave client: owns the year select and "as of" mode, fetches
 * a fresh `getMyLeaveData` whenever the year changes or a dialog mutates
 * something (apply / request credit / cancel), and hands the result down to
 * the header, policy cards, history table, and who's-away panel — all pure
 * display, all driven by the same `computeBalance` the server trusts.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMyLeaveData, type MyLeaveData } from "../server/leave-actions";
import { computeBalance } from "../lib/leave-model";
import { EntitlementHeader, type AsOfMode } from "./entitlement-header";
import { PolicyCards } from "./policy-cards";
import { ApplyLeaveDialog } from "./apply-leave-dialog";
import { RequestCreditDialog } from "./request-credit-dialog";
import { LeaveHistory } from "./leave-history";
import { WhosAway } from "./whos-away";

type LeaveClientProps = {
  organizationSlug: string;
  orgId: string;
  userId: string;
  year: number;
  today: string;
  initialData: MyLeaveData;
};

export function LeaveClient({
  organizationSlug,
  orgId,
  userId,
  year: initialYear,
  today,
  initialData,
}: LeaveClientProps) {
  const { toast } = useToast();
  const t = useTranslations("hr");
  const tRoot = useTranslations();

  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState(initialData);
  const [asOf, setAsOf] = useState<AsOfMode>("today");
  const [applyOpen, setApplyOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const asOfDate = asOf === "today" ? today : `${year}-12-31`;

  const refetch = useCallback(
    async (targetYear: number) => {
      setRefreshing(true);
      try {
        const result = await getMyLeaveData(organizationSlug, targetYear);
        if (result.ok) {
          setData(result.data);
        } else {
          toast({
            title: t("errorTitle"),
            description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
            variant: "destructive",
          });
        }
      } finally {
        setRefreshing(false);
      }
    },
    [organizationSlug, t, tRoot, toast],
  );

  const handleYearChange = (value: string) => {
    const nextYear = Number(value);
    setYear(nextYear);
    void refetch(nextYear);
  };

  const annualType = useMemo(() => data.types.find((type) => type.code === "annual") ?? null, [data.types]);
  const otherTypes = useMemo(() => data.types.filter((type) => type.code !== "annual"), [data.types]);

  const annualBalance = useMemo(
    () => (annualType ? computeBalance(annualType, data.ledger, data.requests, year, asOfDate) : null),
    [annualType, data.ledger, data.requests, year, asOfDate],
  );

  const yearOptions = useMemo(() => [initialYear - 1, initialYear, initialYear + 1], [initialYear]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-heading text-xl font-semibold">{t("nav.myLeave")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={handleYearChange} disabled={refreshing}>
            <SelectTrigger size="sm" aria-label={t("myLeave.yearLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setCreditOpen(true)}>
            {t("myLeave.requestCreditButton")}
          </Button>
          <Button onClick={() => setApplyOpen(true)}>{t("myLeave.applyButton")}</Button>
        </div>
      </div>

      <EntitlementHeader annualType={annualType} balance={annualBalance} asOf={asOf} onAsOfChange={setAsOf} />

      <PolicyCards types={otherTypes} ledger={data.ledger} requests={data.requests} year={year} asOfDate={asOfDate} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LeaveHistory
            organizationSlug={organizationSlug}
            requests={data.requests}
            types={data.types}
            onCancelled={() => void refetch(year)}
            onApply={() => setApplyOpen(true)}
          />
        </div>
        <WhosAway whosAway={data.whosAway} holidays={data.holidays} today={today} />
      </div>

      <ApplyLeaveDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        organizationSlug={organizationSlug}
        orgId={orgId}
        userId={userId}
        year={year}
        today={today}
        types={data.types}
        ledger={data.ledger}
        requests={data.requests}
        holidays={data.holidays.map((h) => h.date)}
        onApplied={() => void refetch(year)}
      />
      <RequestCreditDialog
        open={creditOpen}
        onOpenChange={setCreditOpen}
        organizationSlug={organizationSlug}
        orgId={orgId}
        userId={userId}
        types={data.types}
        onRequested={() => void refetch(year)}
      />
    </div>
  );
}
