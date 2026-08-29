"use client";

/**
 * Screenshot 2: the viewer's own leave-request history. `requests` is
 * already scoped to the signed-in member (getMyLeaveData filters by
 * user_id), so "own only" for the Cancel action just means "status ===
 * pending" — no extra ownership check needed here.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cancelMyLeaveRequest, type MyLeaveRequestRow } from "../server/leave-actions";
import { formatDateRange } from "../lib/date-format";
import type { LeaveTypeInfo } from "../types";

const DOT_PALETTE = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
];

function dotColor(type: LeaveTypeInfo | undefined): string {
  if (!type) return "bg-muted-foreground";
  return DOT_PALETTE[type.sort % DOT_PALETTE.length] ?? "bg-sky-500";
}

function statusVariant(status: MyLeaveRequestRow["status"]): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
      return "default";
    case "pending":
      return "secondary";
    case "rejected":
      return "destructive";
    case "cancelled":
      return "outline";
  }
}

type LeaveHistoryProps = {
  organizationSlug: string;
  requests: MyLeaveRequestRow[];
  types: LeaveTypeInfo[];
  onCancelled: () => void;
};

export function LeaveHistory({ organizationSlug, requests, types, onCancelled }: LeaveHistoryProps) {
  const { toast } = useToast();
  const t = useTranslations("hr.history");
  const tRoot = useTranslations();

  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cancelTarget, setCancelTarget] = useState<MyLeaveRequestRow | null>(null);

  const typeById = useMemo(() => new Map(types.map((type) => [type.id, type])), [types]);

  const filtered = requests.filter((req) => {
    if (typeFilter !== "all" && req.leaveTypeId !== typeFilter) return false;
    if (statusFilter !== "all" && req.status !== statusFilter) return false;
    return true;
  });

  async function confirmCancel() {
    if (!cancelTarget) return;
    const result = await cancelMyLeaveRequest(organizationSlug, cancelTarget.id);
    if (!result.ok) {
      toast({
        title: t("cancelError"),
        description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: t("cancelSuccess") });
    onCancelled();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger size="sm" aria-label={t("typeFilterLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTypes")}</SelectItem>
              {types.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" aria-label={t("statusFilterLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              <SelectItem value="pending">{t("statuses.pending")}</SelectItem>
              <SelectItem value="approved">{t("statuses.approved")}</SelectItem>
              <SelectItem value="rejected">{t("statuses.rejected")}</SelectItem>
              <SelectItem value="cancelled">{t("statuses.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.type")}</TableHead>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.count")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.comment")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((req) => {
                const type = typeById.get(req.leaveTypeId);
                return (
                  <TableRow key={req.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dotColor(type))} />
                        <div className="flex flex-col">
                          <span>{type?.name ?? "—"}</span>
                          {req.breakdown && req.breakdown.carryForwardUsed > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {t("carryForwardSuffix", { n: req.breakdown.carryForwardUsed })}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{formatDateRange(req.startDate, req.endDate)}</TableCell>
                    <TableCell>{req.dayCount}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(req.status)}>{t(`statuses.${req.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{req.decisionNote ?? t("noComment")}</TableCell>
                    <TableCell className="text-right">
                      {req.status === "pending" && (
                        <Button variant="outline" size="sm" onClick={() => setCancelTarget(req)}>
                          {t("cancel")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(next) => !next && setCancelTarget(null)}
        title={t("cancelConfirmTitle")}
        description={t("cancelConfirmDescription")}
        confirmLabel={t("cancelConfirmAction")}
        onConfirm={confirmCancel}
      />
    </Card>
  );
}
