"use client";

/**
 * Requests tab: the approver's pending queue — leave requests and credit
 * requests, each rendered as a `data-testid="pending-request"` card (Task
 * 9's e2e spec selects on that). Approve/Reject each open the same note
 * dialog (optional decision note), whose confirm button carries the same
 * label as the card action that opened it ("Approve"/"Reject") — the RPC
 * behind `decideLeave` can reject an approval with `insufficient_balance`
 * if another approver spent the balance first; that surfaces here as a
 * destructive toast via the action's `messageKey`, same idiom as
 * leave-history.tsx's cancel error.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Paperclip } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  decideLeave,
  decideCredit,
  getAttachmentUrl,
  type PendingLeaveRow,
  type PendingCreditRow,
} from "../server/manage-actions";
import { formatDateRange, formatDisplayDate } from "../lib/date-format";

function AttachmentLink({
  organizationSlug,
  path,
}: {
  organizationSlug: string;
  path: string;
}) {
  const { toast } = useToast();
  const t = useTranslations("hr.manage.pending");
  const tRoot = useTranslations();

  async function open() {
    const result = await getAttachmentUrl(organizationSlug, path);
    if (!result.ok) {
      toast({
        title: t("attachmentError"),
        description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
        variant: "destructive",
      });
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void open()}>
      <Paperclip className="size-3.5" />
      {t("attachmentLink")}
    </Button>
  );
}

type DecisionKind = "leave" | "credit";
type DecisionAction = "approve" | "reject";

type DecisionTarget = {
  kind: DecisionKind;
  id: string;
  action: DecisionAction;
  label: string;
};

type PendingQueueProps = {
  organizationSlug: string;
  pending: PendingLeaveRow[];
  pendingCredits: PendingCreditRow[];
  onDecided: () => void;
};

export function PendingQueue({ organizationSlug, pending, pendingCredits, onDecided }: PendingQueueProps) {
  const { toast } = useToast();
  const tCommon = useTranslations("common");
  const t = useTranslations("hr.manage.pending");
  const tRoot = useTranslations();

  const [target, setTarget] = useState<DecisionTarget | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function openDecision(kind: DecisionKind, id: string, action: DecisionAction) {
    setNote("");
    setTarget({ kind, id, action, label: t(action) });
  }

  async function confirmDecision() {
    if (!target) return;
    setSubmitting(true);
    try {
      const result =
        target.kind === "leave"
          ? await decideLeave(organizationSlug, target.id, target.action, note || undefined)
          : await decideCredit(organizationSlug, target.id, target.action, note || undefined);
      if (!result.ok) {
        toast({
          title: t("decisionError"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t(target.action === "approve" ? "approveSuccess" : "rejectSuccess") });
      setTarget(null);
      onDecided();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("leaveSectionTitle")}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyLeave")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((req) => (
              <Card key={req.id} data-testid="pending-request">
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                  <div>
                    <CardTitle className="text-base">{req.displayName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {req.typeName} · {formatDateRange(req.startDate, req.endDate)} · {t("dayCount", { n: req.dayCount })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => openDecision("leave", req.id, "reject")}>
                      {t("reject")}
                    </Button>
                    <Button size="sm" onClick={() => openDecision("leave", req.id, "approve")}>
                      {t("approve")}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t("justificationLabel")}: </span>
                    {req.justification}
                  </p>
                  {req.attachmentPath && (
                    <AttachmentLink organizationSlug={organizationSlug} path={req.attachmentPath} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("creditSectionTitle")}</h2>
        {pendingCredits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyCredit")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pendingCredits.map((req) => (
              <Card key={req.id} data-testid="pending-request">
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                  <div>
                    <CardTitle className="text-base">{req.displayName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {req.typeName} ·{" "}
                      {t("referenceRange", {
                        start: formatDisplayDate(req.referenceStart),
                        end: formatDisplayDate(req.referenceEnd),
                      })}{" "}
                      · {t("amount", { n: req.amount })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => openDecision("credit", req.id, "reject")}>
                      {t("reject")}
                    </Button>
                    <Button size="sm" onClick={() => openDecision("credit", req.id, "approve")}>
                      {t("approve")}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {req.justification && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">{t("justificationLabel")}: </span>
                      {req.justification}
                    </p>
                  )}
                  {req.attachmentPath && (
                    <AttachmentLink organizationSlug={organizationSlug} path={req.attachmentPath} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Dialog open={!!target} onOpenChange={(next) => !submitting && !next && setTarget(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{target ? t(target.action === "approve" ? "approveTitle" : "rejectTitle") : ""}</DialogTitle>
            <DialogDescription>
              {target ? t(target.action === "approve" ? "approveDescription" : "rejectDescription") : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="decision-note">{t("noteLabel")}</Label>
            <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => setTarget(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              variant={target?.action === "reject" ? "destructive" : "default"}
              disabled={submitting}
              onClick={() => void confirmDecision()}
            >
              {submitting && <Loader2 className="animate-spin" />}
              {target?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
