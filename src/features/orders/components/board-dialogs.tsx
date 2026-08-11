"use client";

import { useEffect, useState } from "react";
import { confirmOrder, cancelOrder, reopenOrder } from "@/features/orders/server/order-actions";
import type { OrderWithItems } from "@/features/orders/types";
import { FALLBACK_LABELS } from "@/features/orders/types";
import { formatWeight, describeFallback } from "@/features/orders/lib/order-model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";

type BaseProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationSlug: string;
  onDone: () => void;
};

export function ConfirmOrderDialog({
  open,
  onOpenChange,
  organizationSlug,
  order,
  onDone,
}: BaseProps & { order: OrderWithItems | null }) {
  const { toast } = useToast();
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvailability(Object.fromEntries(order.items.map((item) => [item.id, true])));
    }
  }, [order]);

  if (!order) return null;

  async function handleConfirm() {
    if (!order) return;
    setSubmitting(true);
    const result = await confirmOrder({
      organizationSlug,
      orderId: order.id,
      decisions: order.items.map((item) => ({
        itemId: item.id,
        available: availability[item.id] ?? true,
      })),
    });
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order confirmed" });
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm order {order.id.slice(0, 8).toUpperCase()}</DialogTitle>
          <DialogDescription>Mark each line available or not before confirming.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {order.items.map((item) => {
            const available = availability[item.id] ?? true;
            return (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{item.product?.name ?? "Unknown product"}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`} · size{" "}
                      {item.size_min_kg}–{item.size_max_kg} kg
                    </div>
                    <div className="text-xs text-muted-foreground">
                      If unavailable: {FALLBACK_LABELS[item.fallback]}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={available ? "default" : "outline"}
                      onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: true }))}
                    >
                      Available
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={!available ? "destructive" : "outline"}
                      onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: false }))}
                    >
                      Not available
                    </Button>
                  </div>
                </div>
                {!available && (
                  <Badge className="mt-2" variant={item.fallback === "cancel" ? "destructive" : "secondary"}>
                    Resulting fallback: {describeFallback(item.fallback)}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button disabled={submitting} onClick={handleConfirm}>
            {submitting ? "Confirming…" : "Confirm order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelOrderBoardDialog({
  open,
  onOpenChange,
  organizationSlug,
  orderId,
  onDone,
}: BaseProps & { orderId: string }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReason("");
    }
  }, [open, orderId]);

  async function handleCancel() {
    setSubmitting(true);
    const result = await cancelOrder(organizationSlug, orderId, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order cancelled" });
    setReason("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel order</DialogTitle>
          <DialogDescription>This cannot be undone. Let the team know why.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for cancelling"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={handleCancel}>
            {submitting ? "Cancelling…" : "Confirm cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenOrderBoardDialog({
  open,
  onOpenChange,
  organizationSlug,
  orderId,
  onDone,
}: BaseProps & { orderId: string }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReason("");
    }
  }, [open, orderId]);

  async function handleReopen() {
    setSubmitting(true);
    const result = await reopenOrder(organizationSlug, orderId, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order reopened" });
    setReason("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen order</DialogTitle>
          <DialogDescription>
            This reverts the order to delivered so settlement can be redone. The action is audit-logged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you reopening this order?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} onClick={handleReopen}>
            {submitting ? "Reopening…" : "Reopen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
