"use client";

/**
 * Top-level Leave Management client: owns the year select and the fetched
 * `getManageData`, and lays out five tabs (Requests / Staff balances /
 * Holidays / Leave types / Year close) that all share the same refetch —
 * every mutation (decide, holiday add/delete, type save, year close)
 * re-fetches the whole page's data rather than patching pieces locally, so
 * the pending queue, staff balances, and holiday list can never drift out
 * of sync with each other after a decision.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getManageData, type ManageData } from "../server/manage-actions";
import { PendingQueue } from "./pending-queue";
import { StaffBalances } from "./staff-balances";
import { HolidaysEditor } from "./holidays-editor";
import { LeaveTypeSettings } from "./leave-type-settings";
import { YearCloseCard } from "./year-close-card";

type ManageClientProps = {
  organizationSlug: string;
  year: number;
  initialData: ManageData;
};

export function ManageClient({ organizationSlug, year: initialYear, initialData }: ManageClientProps) {
  const { toast } = useToast();
  const t = useTranslations("hr");
  const tManage = useTranslations("hr.manage");
  const tRoot = useTranslations();

  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);

  const refetch = useCallback(
    async (targetYear: number) => {
      setRefreshing(true);
      try {
        const result = await getManageData(organizationSlug, targetYear);
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

  const yearOptions = useMemo(() => [initialYear - 1, initialYear, initialYear + 1], [initialYear]);

  const pendingCount = data.pending.length + data.pendingCredits.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-heading text-xl font-semibold">{tManage("title")}</h1>
        <Select value={String(year)} onValueChange={handleYearChange} disabled={refreshing}>
          <SelectTrigger size="sm" aria-label={tManage("yearLabel")}>
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
      </div>

      <Tabs defaultValue="requests" className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="requests">
              {tManage("tabs.requests")}
              {pendingCount > 0 ? ` (${pendingCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="staffBalances">{tManage("tabs.staffBalances")}</TabsTrigger>
            <TabsTrigger value="holidays">{tManage("tabs.holidays")}</TabsTrigger>
            <TabsTrigger value="leaveTypes">{tManage("tabs.leaveTypes")}</TabsTrigger>
            <TabsTrigger value="yearClose">{tManage("tabs.yearClose")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="requests" className="m-0">
          <PendingQueue
            organizationSlug={organizationSlug}
            pending={data.pending}
            pendingCredits={data.pendingCredits}
            onDecided={() => void refetch(year)}
          />
        </TabsContent>

        <TabsContent value="staffBalances" className="m-0">
          <StaffBalances staff={data.staff} types={data.types} />
        </TabsContent>

        <TabsContent value="holidays" className="m-0">
          <HolidaysEditor
            organizationSlug={organizationSlug}
            year={year}
            holidays={data.holidays}
            onChanged={() => void refetch(year)}
          />
        </TabsContent>

        <TabsContent value="leaveTypes" className="m-0">
          <LeaveTypeSettings
            organizationSlug={organizationSlug}
            types={data.types}
            onSaved={() => void refetch(year)}
          />
        </TabsContent>

        <TabsContent value="yearClose" className="m-0">
          <YearCloseCard organizationSlug={organizationSlug} year={year} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
