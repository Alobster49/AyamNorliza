"use client";

/**
 * Year close tab: pick a year, close it. `close_leave_year` (the RPC behind
 * `closeYear`) computes and inserts each member's unused-Annual-Leave
 * carry-forward (capped per leave type) into next year's ledger — a
 * one-way operation, hence the `ConfirmDialog` gate, same idiom as
 * `delivery_run_status`'s one-way transitions elsewhere in this app.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { closeYear } from "../server/manage-actions";

type YearCloseCardProps = {
  organizationSlug: string;
  year: number;
};

export function YearCloseCard({ organizationSlug, year: initialYear }: YearCloseCardProps) {
  const { toast } = useToast();
  const t = useTranslations("hr.manage.yearClose");
  const tRoot = useTranslations();

  const [year, setYear] = useState(initialYear);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const nextYear = year + 1;
  const yearOptions = [initialYear - 2, initialYear - 1, initialYear];

  async function handleClose() {
    const result = await closeYear(organizationSlug, year);
    if (!result.ok) {
      toast({
        title: t("error"),
        description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: t("success", { n: result.data.inserted }) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger size="sm" aria-label={t("yearLabel")}>
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
          <Button type="button" onClick={() => setConfirmOpen(true)}>
            {t("closeButton", { year, nextYear })}
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("confirmTitle", { year })}
        description={t("confirmDescription", { nextYear })}
        confirmLabel={t("confirmAction")}
        onConfirm={handleClose}
      />
    </Card>
  );
}
