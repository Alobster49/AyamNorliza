"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cancelMyOrder } from "@/features/orders/server/portal-actions";

type CancelOrderButtonProps = {
  organizationSlug: string;
  orderId: string;
};

export function CancelOrderButton({ orderId }: CancelOrderButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("buyer.orderDetail");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCancel = async () => {
    setSubmitting(true);
    const result = await cancelMyOrder(orderId, reason.trim() || undefined);
    setSubmitting(false);

    if (!result.ok) {
      toast({
        title: t("error"),
        description: result.message,
        variant: "destructive",
      });
      return;
    }

    setOpen(false);
    toast({ title: t("orderCancelledToast") });
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <X className="mr-2 h-4 w-4" />
          {t("cancelOrder")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cancelDialogTitle")}</DialogTitle>
          <DialogDescription>{t("cancelDialogDescription")}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("cancelReasonPlaceholder")}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            {t("keepOrder")}
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("cancelling")}
              </>
            ) : (
              t("cancelOrder")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
