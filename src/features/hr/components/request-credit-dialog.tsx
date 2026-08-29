"use client";

/**
 * Screenshot 4: request a replacement-leave credit. `credit_type` is
 * DB-fixed to 'replacement' (the only value the check constraint allows),
 * shown as a read-only field; the leave type picker chooses which type's
 * balance the credit lands on (defaults to Annual). Same upload-then-call
 * pattern as apply-leave-dialog.tsx.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
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
import { requestLeaveCredit } from "../server/leave-actions";
import type { LeaveTypeInfo } from "../types";

const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

type RequestCreditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationSlug: string;
  orgId: string;
  userId: string;
  types: LeaveTypeInfo[];
  onRequested: () => void;
};

export function RequestCreditDialog({
  open,
  onOpenChange,
  organizationSlug,
  orgId,
  userId,
  types,
  onRequested,
}: RequestCreditDialogProps) {
  const { toast } = useToast();
  const tCommon = useTranslations("common");
  const t = useTranslations("hr.credit");
  const tRoot = useTranslations();

  const defaultTypeId = useMemo(
    () => types.find((type) => type.code === "annual")?.id ?? types[0]?.id ?? "",
    [types],
  );

  const [leaveTypeId, setLeaveTypeId] = useState(defaultTypeId);
  const [amount, setAmount] = useState("1");
  const [referenceStart, setReferenceStart] = useState("");
  const [referenceEnd, setReferenceEnd] = useState("");
  const [justification, setJustification] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form on open; a lazy initializer can't see the `open` transition
      setLeaveTypeId(defaultTypeId);
      setAmount("1");
      setReferenceStart("");
      setReferenceEnd("");
      setJustification("");
      setFile(null);
    }
  }, [open, defaultTypeId]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!leaveTypeId) return;
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
          toast({
            title: tRoot("hr.errors.uploadFailed"),
            description: uploadError.message,
            variant: "destructive",
          });
          return;
        }
        attachmentPath = path;
      }

      const result = await requestLeaveCredit(organizationSlug, {
        leaveTypeId,
        amount: Number(amount),
        referenceStart,
        referenceEnd,
        justification: justification || undefined,
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
      onRequested();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credit-leave-type">{t("typeLabel")}</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger id="credit-leave-type">
                <SelectValue placeholder={t("typePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("creditTypeLabel")}</Label>
            <div className="flex h-8 items-center rounded-2xl border border-transparent bg-input/50 px-2.5 text-sm text-muted-foreground">
              {t("replacement")}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="credit-amount">{t("amountLabel")}</Label>
            <Input
              id="credit-amount"
              type="number"
              min="0.5"
              step="0.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="credit-ref-start">{t("referenceStartLabel")}</Label>
              <Input
                id="credit-ref-start"
                type="date"
                value={referenceStart}
                onChange={(e) => setReferenceStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-ref-end">{t("referenceEndLabel")}</Label>
              <Input
                id="credit-ref-end"
                type="date"
                value={referenceEnd}
                onChange={(e) => setReferenceEnd(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="credit-justification">{t("justificationLabel")}</Label>
            <Textarea
              id="credit-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="credit-attachment">{t("attachmentLabel")}</Label>
            <Input
              id="credit-attachment"
              type="file"
              accept={ATTACHMENT_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={submitting || !leaveTypeId}>
              {submitting && <Loader2 className="animate-spin" />}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
