"use client";

/**
 * Screenshot 3: apply for leave. Dialog form pattern mirrors
 * category-dialog.tsx. The type list is plain radio inputs (no
 * RadioGroup primitive in this repo's ui/ kit) so each row's accessible
 * name is "<type name> <n> remaining" / "<type name> Upon Request" — Task
 * 9's e2e spec selects it with `getByRole("radio", { name: /annual/i })`.
 *
 * Attachment upload happens client-side (browser Supabase client) straight
 * to the private `leave-attachments` bucket at
 * `{orgId}/{userId}/{uuid}.{ext}` — the same own-folder path
 * `applyLeave` checks server-side — then the resulting path is handed to
 * the action; the file itself never touches the Server Action payload.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { applyLeave } from "../server/leave-actions";
import { computeBalance, validateApplication, workdayCount } from "../lib/leave-model";
import type { LedgerEntry, LeaveRequestSummary, LeaveTypeInfo } from "../types";

const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

type ApplyLeaveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationSlug: string;
  orgId: string;
  userId: string;
  year: number;
  today: string;
  types: LeaveTypeInfo[];
  ledger: LedgerEntry[];
  requests: LeaveRequestSummary[];
  holidays: string[];
  onApplied: () => void;
};

export function ApplyLeaveDialog({
  open,
  onOpenChange,
  organizationSlug,
  orgId,
  userId,
  year,
  today,
  types,
  ledger,
  requests,
  holidays,
  onApplied,
}: ApplyLeaveDialogProps) {
  const { toast } = useToast();
  const tCommon = useTranslations("common");
  const t = useTranslations("hr.apply");
  const tRoot = useTranslations();

  const [selectedYear, setSelectedYear] = useState(year);
  const [typeId, setTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [justification, setJustification] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fresh form every time the dialog opens, never a stale draft from a
  // previous submit.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form on open; a lazy initializer can't see the `open` transition
      setSelectedYear(year);
      setTypeId("");
      setStartDate("");
      setEndDate("");
      setJustification("");
      setFile(null);
    }
  }, [open, year]);

  const yearOptions = useMemo(() => [year, year + 1], [year]);
  const selectedType = types.find((type) => type.id === typeId) ?? null;

  const dayCount =
    startDate && endDate ? workdayCount(startDate, endDate, holidays) : 0;

  const validation = useMemo(() => {
    if (!selectedType || !startDate || !endDate) return null;
    const balance = computeBalance(selectedType, ledger, requests, selectedYear, today);
    return validateApplication({
      type: selectedType,
      startDate,
      endDate,
      dayCount,
      balance,
      attachmentProvided: !!file,
    });
  }, [selectedType, startDate, endDate, dayCount, ledger, requests, selectedYear, today, file]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedType) return;
    setSubmitting(true);
    try {
      let attachmentPath: string | null = null;
      if (file) {
        const supabase = createSupabaseBrowserClient();
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        const path = `${orgId}/${userId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("leave-attachments")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          toast({ title: t("error"), description: uploadError.message, variant: "destructive" });
          return;
        }
        attachmentPath = path;
      }

      const result = await applyLeave(organizationSlug, {
        leaveTypeId: selectedType.id,
        startDate,
        endDate,
        justification,
        attachmentPath,
      });
      if (!result.ok) {
        toast({
          title: t("error"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }

      toast({ title: t("success") });
      onOpenChange(false);
      onApplied();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apply-leave-year">{t("yearLabel")}</Label>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger id="apply-leave-year">
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

          <div className="space-y-2">
            <Label>{t("typeLabel")}</Label>
            <div className="space-y-2">
              {types.map((type) => {
                const balance = computeBalance(type, ledger, requests, selectedYear, today);
                const inputId = `apply-leave-type-${type.id}`;
                return (
                  <label
                    key={type.id}
                    htmlFor={inputId}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-2xl border px-3 py-2 transition-colors",
                      typeId === type.id ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        id={inputId}
                        name="leaveType"
                        value={type.id}
                        checked={typeId === type.id}
                        onChange={() => setTypeId(type.id)}
                        required
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm font-medium">{type.name}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {balance.uponRequest ? t("uponRequest") : t("remaining", { n: balance.available })}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="apply-leave-start">{t("startDateLabel")}</Label>
              <Input
                id="apply-leave-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apply-leave-end">{t("endDateLabel")}</Label>
              <Input
                id="apply-leave-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apply-leave-justification">{t("justificationLabel")}</Label>
            <Textarea
              id="apply-leave-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apply-leave-attachment">{t("attachmentLabel")}</Label>
            <Input
              id="apply-leave-attachment"
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required={selectedType?.requiresAttachment ?? false}
            />
            {selectedType?.requiresAttachment && (
              <p className="text-xs text-muted-foreground">{t("attachmentRequiredHint")}</p>
            )}
          </div>

          <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              {dayCount > 0 && <p className="text-muted-foreground">{t("dayCount", { n: dayCount })}</p>}
              {validation && !validation.ok && (
                <p className="text-xs text-destructive">
                  {tRoot(`hr.errors.${validation.reason}` as never)}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={submitting || !typeId}>
                {submitting && <Loader2 className="animate-spin" />}
                {t("submit")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
