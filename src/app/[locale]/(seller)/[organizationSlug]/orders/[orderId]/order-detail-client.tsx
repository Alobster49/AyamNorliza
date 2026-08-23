"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getOrderDetail,
  getPriceHints,
  confirmOrder,
  cancelOrder,
  closeOrder,
  reopenOrder,
} from "@/features/orders/server/order-actions";
import type { OrderWithItems } from "@/features/orders/types";
import type { MarketSuggestion } from "@/features/market/types";
import { JourneyBar, NextActionBanner } from "@/features/orders/components/journey-bar";
import { pickPriceHint, settlementReady } from "@/features/orders/lib/settlement-hints";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, FALLBACK_LABELS } from "@/features/orders/types";
import {
  formatPrice,
  formatWeight,
  computeLineTotal,
  weightWarnings,
  describeFallback,
} from "@/features/orders/lib/order-model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ArrowLeft, ChevronDown, Phone, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type OrderDetailClientProps = {
  organizationSlug: string;
  callerRole: string;
  initialOrder: OrderWithItems | null;
};

export function OrderDetailClient({ organizationSlug, callerRole, initialOrder }: OrderDetailClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [order, setOrder] = useState(initialOrder);

  async function reloadOrder() {
    if (!order) return;
    const result = await getOrderDetail(organizationSlug, order.id);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    setOrder(result.data);
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="outline" onClick={() => router.push(`/${organizationSlug}/orders`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to orders
        </Button>
      </div>
    );
  }

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-MY", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/${organizationSlug}/orders`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Order {order.id.slice(0, 8).toUpperCase()}</h1>
          <p className="text-muted-foreground">{order.customer?.name ?? "Unknown customer"}</p>
          {order.customer?.phone && (
            <a
              href={`tel:${order.customer.phone}`}
              className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              <Phone className="h-3 w-3" aria-hidden />
              {order.customer.phone}
            </a>
          )}
        </div>
        <Badge className={ORDER_STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
      </div>

      <JourneyBar status={order.status} />
      <NextActionBanner status={order.status} itemCount={order.items.length} />

      {order.status === "delivered" ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border p-4 text-left text-sm">
            <span className="text-muted-foreground">
              Delivery details — {order.zone?.name ?? "-"}
              {order.truck?.code ? ` · ${order.truck.code}` : ""} · {formatDate(order.delivery_date)}
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2">
              <OrderMetaGrid order={order} formatDate={formatDate} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <OrderMetaGrid order={order} formatDate={formatDate} />
      )}

      {order.notes && (
        <div className="rounded-lg border p-4">
          <h2 className="mb-2 font-semibold">Notes</h2>
          <p className="whitespace-pre-line text-sm text-muted-foreground">{order.notes}</p>
        </div>
      )}

      {order.status === "pending" && (
        <PendingPanel order={order} organizationSlug={organizationSlug} onReload={reloadOrder} />
      )}
      {(order.status === "confirmed" || order.status === "ready") && (
        <ConfirmedReadyPanel order={order} organizationSlug={organizationSlug} onReload={reloadOrder} />
      )}
      {order.status === "delivered" && (
        <DeliveredPanel order={order} organizationSlug={organizationSlug} onReload={reloadOrder} />
      )}
      {order.status === "closed" && (
        <ClosedPanel
          order={order}
          callerRole={callerRole}
          organizationSlug={organizationSlug}
          onReload={reloadOrder}
        />
      )}
      {order.status === "cancelled" && (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">This order was cancelled.</div>
      )}
    </div>
  );
}

function OrderMetaGrid({
  order,
  formatDate,
}: {
  order: OrderWithItems;
  formatDate: (date: string) => string;
}) {
  return (
    <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <div className="text-xs text-muted-foreground">Zone</div>
        <div className="font-medium">{order.zone?.name ?? "-"}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Delivery date</div>
        <div className="font-medium">{formatDate(order.delivery_date)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Truck</div>
        <div className="font-medium">
          {order.truck?.name ?? "-"} {order.truck?.code ? `(${order.truck.code})` : ""}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Address</div>
        <div className="font-medium">{order.delivery_address}</div>
      </div>
    </div>
  );
}

function CancelOrderDialog({
  organizationSlug,
  orderId,
  onReload,
  triggerLabel = "Cancel order",
}: {
  organizationSlug: string;
  orderId: string;
  onReload: () => void;
  triggerLabel?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCancel() {
    setSubmitting(true);
    const result = await cancelOrder(organizationSlug, orderId, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order cancelled" });
    setOpen(false);
    onReload();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel order</DialogTitle>
          <DialogDescription>This cannot be undone. Let the team know why.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for cancelling" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
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

function PendingPanel({
  order,
  organizationSlug,
  onReload,
}: {
  order: OrderWithItems;
  organizationSlug: string;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const [availability, setAvailability] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, true])),
  );
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setConfirming(true);
    const result = await confirmOrder({
      organizationSlug,
      orderId: order.id,
      decisions: order.items.map((item) => ({
        itemId: item.id,
        available: availability[item.id] ?? true,
      })),
    });
    setConfirming(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order confirmed" });
    onReload();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {order.items.map((item) => {
          const available = availability[item.id] ?? true;
          return (
            <div key={item.id} className="rounded-lg border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div>
                  <div className="font-medium">{item.product?.name ?? "Unknown product"}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`} · size{" "}
                    {item.size_min_kg}–{item.size_max_kg} kg
                  </div>
                  <div className="text-sm text-muted-foreground">If unavailable: {FALLBACK_LABELS[item.fallback]}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
                <Badge className="mt-3" variant={item.fallback === "cancel" ? "destructive" : "secondary"}>
                  Resulting fallback: {describeFallback(item.fallback)}
                </Badge>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button className="w-full sm:w-auto" size="lg" disabled={confirming} onClick={handleConfirm}>
          {confirming ? "Confirming…" : "Confirm order"}
        </Button>
        <CancelOrderDialog organizationSlug={organizationSlug} orderId={order.id} onReload={onReload} />
      </div>
    </div>
  );
}

function ConfirmedReadyPanel({
  order,
  organizationSlug,
  onReload,
}: {
  order: OrderWithItems;
  organizationSlug: string;
  onReload: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">Order lines</h2>
        <div className="space-y-2">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span>
                {item.product?.name ?? "Item"} —{" "}
                {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`}
              </span>
              {item.is_cancelled ? (
                <Badge variant="destructive">Cancelled</Badge>
              ) : item.fallback_applied ? (
                <Badge variant="secondary">{describeFallback(item.fallback_applied)}</Badge>
              ) : (
                <Badge variant="outline">As ordered</Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">Warehouse task</h2>
        {(order.tasks ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No task recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {order.tasks!.map((task) => (
              <li key={task.id} className="flex items-center justify-between text-sm">
                <span>{task.type === "allocate_weigh" ? "Allocate & weigh" : task.type}</span>
                <Badge variant={task.status === "done" ? "secondary" : "outline"}>
                  {task.status === "done" ? "Done" : "Pending"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CancelOrderDialog organizationSlug={organizationSlug} orderId={order.id} onReload={onReload} />
    </div>
  );
}

type SettlementDraft = { finalWeightKg: string; finalPieces: string; pricePerKg: string };

function DeliveredPanel({
  order,
  organizationSlug,
  onReload,
}: {
  order: OrderWithItems;
  organizationSlug: string;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const nonCancelled = order.items.filter((item) => !item.is_cancelled);
  const [hints, setHints] = useState<MarketSuggestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SettlementDraft>>(() =>
    Object.fromEntries(
      nonCancelled.map((item) => [
        item.id,
        {
          finalWeightKg: item.warehouse_weight_kg != null ? String(item.warehouse_weight_kg) : "",
          finalPieces: item.warehouse_pieces != null ? String(item.warehouse_pieces) : "",
          pricePerKg: "",
        },
      ]),
    ),
  );
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // Hints are a nice-to-have: a failed load just means no chips.
    let alive = true;
    getPriceHints(organizationSlug).then((result) => {
      if (alive && result.ok) setHints(result.data);
    });
    return () => {
      alive = false;
    };
  }, [organizationSlug]);

  function updateDraft(itemId: string, field: keyof SettlementDraft, value: string) {
    setDrafts((prev) => {
      const existing = prev[itemId] ?? { finalWeightKg: "", finalPieces: "", pricePerKg: "" };
      return { ...prev, [itemId]: { ...existing, [field]: value } };
    });
  }

  function parseNum(value: string): number | null {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  const lines = nonCancelled.map((item) => {
    const draft = drafts[item.id] ?? { finalWeightKg: "", finalPieces: "", pricePerKg: "" };
    const finalWeightKg = parseNum(draft.finalWeightKg);
    const finalPieces = parseNum(draft.finalPieces);
    const pricePerKg = parseNum(draft.pricePerKg);
    const lineTotal = finalWeightKg != null && pricePerKg != null ? computeLineTotal(finalWeightKg, pricePerKg) : null;
    const warnings = weightWarnings({
      id: item.id,
      mode: item.mode,
      quantity: item.quantity,
      size_min_kg: item.size_min_kg,
      size_max_kg: item.size_max_kg,
      warehouse_weight_kg: item.warehouse_weight_kg,
      final_weight_kg: finalWeightKg,
      final_pieces: finalPieces,
      warehouse_pieces: item.warehouse_pieces,
    });
    return { item, draft, finalWeightKg, finalPieces, pricePerKg, lineTotal, warnings };
  });

  const runningTotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const allReady = settlementReady(lines);

  async function handleClose() {
    const invalid = lines.find(
      (line) =>
        line.finalWeightKg == null || line.finalWeightKg <= 0 || line.pricePerKg == null || line.pricePerKg < 0,
    );
    if (invalid) {
      toast({
        title: "Error",
        description: `Enter a final weight and price per kg for ${invalid.item.product?.name ?? "every line"}.`,
        variant: "destructive",
      });
      return;
    }

    setClosing(true);
    const result = await closeOrder({
      organizationSlug,
      orderId: order.id,
      lines: lines.map((line) => ({
        itemId: line.item.id,
        finalWeightKg: line.finalWeightKg!,
        finalPieces: line.finalPieces ?? undefined,
        pricePerKg: line.pricePerKg!,
      })),
    });
    setClosing(false);

    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }

    toast({ title: "Order closed", description: `Total: ${formatPrice(result.data.total)}` });
    onReload();
  }

  return (
    <div className="space-y-4">
      {lines.map(({ item, draft, lineTotal, warnings }) => (
        <div key={item.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">{item.product?.name ?? "Unknown product"}</div>
              <div className="text-sm text-muted-foreground">
                Warehouse: {item.warehouse_weight_kg != null ? formatWeight(item.warehouse_weight_kg) : "-"}
                {item.warehouse_pieces != null ? ` · ${item.warehouse_pieces} pcs` : ""}
              </div>
            </div>
            <div className="text-right font-medium">{lineTotal != null ? formatPrice(lineTotal) : "—"}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Final weight (kg)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={draft.finalWeightKg}
                onChange={(e) => updateDraft(item.id, "finalWeightKg", e.target.value)}
              />
              {item.warehouse_weight_kg != null &&
                draft.finalWeightKg === String(item.warehouse_weight_kg) && (
                  <p className="text-xs text-muted-foreground">from warehouse</p>
                )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Final pieces</Label>
              <Input
                type="number"
                step="1"
                min="0"
                placeholder="optional"
                value={draft.finalPieces}
                onChange={(e) => updateDraft(item.id, "finalPieces", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <Label className="text-xs">Price / kg (RM)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={draft.pricePerKg}
                onChange={(e) => updateDraft(item.id, "pricePerKg", e.target.value)}
              />
              {(() => {
                const hint = pickPriceHint(hints, item.product?.name);
                if (hint == null) return null;
                return (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-500/20 dark:text-blue-400"
                    onClick={() => updateDraft(item.id, "pricePerKg", String(hint))}
                  >
                    <Zap className="h-3 w-3" aria-hidden />
                    Market today: {formatPrice(hint)}
                  </button>
                );
              })()}
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="space-y-1">
              {warnings.map((warning) => (
                <p key={warning.kind} className="rounded-md bg-amber-100 px-3 py-1.5 text-sm text-amber-800">
                  {warning.message}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="sticky bottom-2 z-10 flex items-center gap-4 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
        <div className="shrink-0">
          <div className="text-xs text-muted-foreground">Running total</div>
          <div className="text-xl font-bold tabular-nums">
            {allReady ? formatPrice(runningTotal) : "—"}
          </div>
        </div>
        <Button className="flex-1" size="lg" disabled={closing || !allReady} onClick={handleClose}>
          {closing ? "Closing…" : "Close order"}
        </Button>
      </div>
      {!allReady && (
        <p className="text-center text-xs text-muted-foreground">
          Enter a weight and price on every line to close.
        </p>
      )}
    </div>
  );
}

function ClosedPanel({
  order,
  callerRole,
  organizationSlug,
  onReload,
}: {
  order: OrderWithItems;
  callerRole: string;
  organizationSlug: string;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canReopen = callerRole === "owner" || callerRole === "org_admin";
  const nonCancelled = order.items.filter((item) => !item.is_cancelled);

  async function handleReopen() {
    setSubmitting(true);
    const result = await reopenOrder(organizationSlug, order.id, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order reopened" });
    setReopenOpen(false);
    onReload();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">Settlement summary</h2>
        <div className="space-y-2">
          {nonCancelled.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>
                {item.product?.name ?? "Item"} —{" "}
                {item.final_weight_kg != null ? formatWeight(item.final_weight_kg) : "-"} @{" "}
                {item.price_per_kg != null ? formatPrice(item.price_per_kg) : "-"}/kg
              </span>
              <span className="font-medium">{item.line_total != null ? formatPrice(item.line_total) : "-"}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t pt-3 text-lg font-bold">
          <span>Total</span>
          <span>{formatPrice(order.total_amount)}</span>
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Weight log</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Weight</TableHead>
              <TableHead>Pieces</TableHead>
              <TableHead>Recorded at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(order.weight_log ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No weight log entries
                </TableCell>
              </TableRow>
            ) : (
              order.weight_log!.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="capitalize">{log.kind}</TableCell>
                  <TableCell>{formatWeight(log.weight_kg)}</TableCell>
                  <TableCell>{log.pieces ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(log.recorded_at).toLocaleString("en-MY")}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {canReopen && (
        <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">Reopen order</Button>
          </DialogTrigger>
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
              <Button variant="outline" onClick={() => setReopenOpen(false)}>
                Cancel
              </Button>
              <Button disabled={submitting} onClick={handleReopen}>
                {submitting ? "Reopening…" : "Reopen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
