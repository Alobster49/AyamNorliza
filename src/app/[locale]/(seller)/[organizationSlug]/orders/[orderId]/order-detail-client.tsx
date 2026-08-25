"use client";

import { useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "@/i18n/navigation";
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
import { ORDER_STATUS_COLORS } from "@/features/orders/types";
import {
  formatPrice,
  formatWeight,
  computeLineTotal,
  weightWarnings,
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
  const t = useTranslations("orders.detail");
  const tStatus = useTranslations("status.order");
  const tError = useTranslations("orders");
  const tRoot = useTranslations();
  const format = useFormatter();
  const [order, setOrder] = useState(initialOrder);

  async function reloadOrder() {
    if (!order) return;
    const result = await getOrderDetail(organizationSlug, order.id);
    if (!result.ok) {
      toast({ title: tError("error"), description: result.messageKey ? tRoot(result.messageKey as never) : result.message, variant: "destructive" });
      return;
    }
    setOrder(result.data);
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push(`/${organizationSlug}/orders`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("backToOrders")}
        </Button>
      </div>
    );
  }

  const formatDate = (date: string) =>
    format.dateTime(new Date(date), {
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
          <h1 className="text-2xl font-bold">{t("heading", { id: order.id.slice(0, 8).toUpperCase() })}</h1>
          <p className="text-muted-foreground">{order.customer?.name ?? t("unknownCustomer")}</p>
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
        <Badge className={ORDER_STATUS_COLORS[order.status]}>{tStatus(order.status)}</Badge>
      </div>

      <JourneyBar status={order.status} />
      <NextActionBanner status={order.status} itemCount={order.items.length} />

      {order.status === "delivered" ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border p-4 text-left text-sm">
            <span className="text-muted-foreground">
              {t("deliverySummary", {
                zone: order.zone?.name ?? "-",
                truck: order.truck?.code ? ` · ${order.truck.code}` : "",
                date: formatDate(order.delivery_date),
              })}
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
          <h2 className="mb-2 font-semibold">{t("notes")}</h2>
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
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">{t("cancelledNotice")}</div>
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
  const t = useTranslations("orders.detail.meta");
  return (
    <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <div className="text-xs text-muted-foreground">{t("zone")}</div>
        <div className="font-medium">{order.zone?.name ?? "-"}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{t("deliveryDate")}</div>
        <div className="font-medium">{formatDate(order.delivery_date)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{t("truck")}</div>
        <div className="font-medium">
          {order.truck?.name ?? "-"} {order.truck?.code ? `(${order.truck.code})` : ""}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{t("address")}</div>
        <div className="font-medium">{order.delivery_address}</div>
      </div>
    </div>
  );
}

function CancelOrderDialog({
  organizationSlug,
  orderId,
  onReload,
  triggerLabel,
}: {
  organizationSlug: string;
  orderId: string;
  onReload: () => void;
  triggerLabel?: string;
}) {
  const { toast } = useToast();
  const t = useTranslations("orders.dialogs.cancel");
  const tError = useTranslations("orders");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCancel() {
    setSubmitting(true);
    const result = await cancelOrder(organizationSlug, orderId, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: tError("error"), description: result.messageKey ? tRoot(result.messageKey as never) : result.message, variant: "destructive" });
      return;
    }
    toast({ title: t("cancelledToast") });
    setOpen(false);
    onReload();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{triggerLabel ?? t("trigger")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t("reasonLabel")}</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tCommon("back")}
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={handleCancel}>
            {submitting ? t("cancelling") : t("confirmCancel")}
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
  const t = useTranslations("orders.detail.pending");
  const tFallback = useTranslations("orders.fallback");
  const tUnits = useTranslations("orders.units");
  const tError = useTranslations("orders");
  const tRoot = useTranslations();
  const [availability, setAvailability] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, true])),
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, ""])),
  );
  const [hints, setHints] = useState<MarketSuggestion[]>([]);
  const [confirming, setConfirming] = useState(false);

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

  function parsePrice(value: string): number | null {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // A line needs a price unless it is about to be cancelled outright.
  function needsPrice(item: OrderWithItems["items"][number]): boolean {
    const available = availability[item.id] ?? true;
    return available || item.fallback !== "cancel";
  }

  const allPriced = order.items.every(
    (item) => !needsPrice(item) || parsePrice(prices[item.id] ?? "") != null,
  );

  async function handleConfirm() {
    setConfirming(true);
    const result = await confirmOrder({
      organizationSlug,
      orderId: order.id,
      decisions: order.items.map((item) => ({
        itemId: item.id,
        available: availability[item.id] ?? true,
        pricePerKg: needsPrice(item) ? (parsePrice(prices[item.id] ?? "") ?? undefined) : undefined,
      })),
    });
    setConfirming(false);
    if (!result.ok) {
      toast({ title: tError("error"), description: result.messageKey ? tRoot(result.messageKey as never) : result.message, variant: "destructive" });
      return;
    }
    toast({ title: t("confirmedToast") });
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
                  <div className="font-medium">{item.product?.name ?? t("unknownProduct")}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.mode === "kg" ? formatWeight(item.quantity) : tUnits("pieces", { count: item.quantity })} ·
                    size {item.size_min_kg}–{item.size_max_kg} kg
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t("unavailableNote", { fallback: tFallback(item.fallback) })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={available ? "default" : "outline"}
                    onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: true }))}
                  >
                    {t("available")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={!available ? "destructive" : "outline"}
                    onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: false }))}
                  >
                    {t("notAvailable")}
                  </Button>
                </div>
              </div>
              {!available && (
                <Badge className="mt-3" variant={item.fallback === "cancel" ? "destructive" : "secondary"}>
                  {t("resultingFallback", { fallback: tFallback(item.fallback) })}
                </Badge>
              )}
              {needsPrice(item) && (
                <div className="mt-3 max-w-xs space-y-1">
                  <Label className="text-xs">{t("pricePerKg")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={prices[item.id] ?? ""}
                    onChange={(e) =>
                      setPrices((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                  />
                  {(() => {
                    const hint = pickPriceHint(hints, item.product?.name);
                    if (hint == null) return null;
                    return (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-500/20 dark:text-blue-400"
                        onClick={() =>
                          setPrices((prev) => ({ ...prev, [item.id]: String(hint) }))
                        }
                      >
                        <Zap className="h-3 w-3" aria-hidden />
                        {t("marketToday", { price: formatPrice(hint) })}
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="w-full sm:w-auto"
          size="lg"
          disabled={confirming || !allPriced}
          onClick={handleConfirm}
        >
          {confirming ? t("confirming") : t("confirmOrder")}
        </Button>
        <CancelOrderDialog organizationSlug={organizationSlug} orderId={order.id} onReload={onReload} />
      </div>
      {!allPriced && (
        <p className="text-xs text-muted-foreground">{t("enterToConfirm")}</p>
      )}
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
  const t = useTranslations("orders.detail.confirmedReady");
  const tFallback = useTranslations("orders.fallback");
  const tUnits = useTranslations("orders.units");
  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">{t("orderLines")}</h2>
        <div className="space-y-2">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span>
                {item.product?.name ?? t("item")} —{" "}
                {item.mode === "kg" ? formatWeight(item.quantity) : tUnits("pieces", { count: item.quantity })}
                {!item.is_cancelled && item.price_per_kg != null && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {t("perKg", { price: formatPrice(item.price_per_kg) })}
                  </span>
                )}
              </span>
              {item.is_cancelled ? (
                <Badge variant="destructive">{t("cancelled")}</Badge>
              ) : item.fallback_applied ? (
                <Badge variant="secondary">{tFallback(item.fallback_applied)}</Badge>
              ) : (
                <Badge variant="outline">{t("asOrdered")}</Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">{t("warehouseTask")}</h2>
        {(order.tasks ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTaskYet")}</p>
        ) : (
          <ul className="space-y-2">
            {order.tasks!.map((task) => (
              <li key={task.id} className="flex items-center justify-between text-sm">
                <span>{task.type === "allocate_weigh" ? t("allocateWeigh") : task.type}</span>
                <Badge variant={task.status === "done" ? "secondary" : "outline"}>
                  {task.status === "done" ? t("done") : t("pendingTask")}
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
  const t = useTranslations("orders.detail.delivered");
  const tWarnings = useTranslations("orders.detail.delivered.warnings");
  const tUnits = useTranslations("orders.units");
  const tError = useTranslations("orders");
  const tRoot = useTranslations();
  const nonCancelled = order.items.filter((item) => !item.is_cancelled);
  const [hints, setHints] = useState<MarketSuggestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SettlementDraft>>(() =>
    Object.fromEntries(
      nonCancelled.map((item) => [
        item.id,
        {
          finalWeightKg: item.warehouse_weight_kg != null ? String(item.warehouse_weight_kg) : "",
          finalPieces: item.warehouse_pieces != null ? String(item.warehouse_pieces) : "",
          pricePerKg: item.price_per_kg != null ? String(item.price_per_kg) : "",
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
        title: tError("error"),
        description: t("missingFields", { product: invalid.item.product?.name ?? t("everyLine") }),
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
      toast({ title: tError("error"), description: result.messageKey ? tRoot(result.messageKey as never) : result.message, variant: "destructive" });
      return;
    }

    toast({ title: t("closedTitle"), description: t("closedTotal", { total: formatPrice(result.data.total) }) });
    onReload();
  }

  return (
    <div className="space-y-4">
      {lines.map(({ item, draft, lineTotal, warnings }) => (
        <div key={item.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">{item.product?.name ?? t("unknownProduct")}</div>
              <div className="text-sm text-muted-foreground">
                {t("warehouse", {
                  weight: item.warehouse_weight_kg != null ? formatWeight(item.warehouse_weight_kg) : "-",
                })}
                {item.warehouse_pieces != null
                  ? ` · ${tUnits("pieces", { count: item.warehouse_pieces })}`
                  : ""}
              </div>
            </div>
            <div className="text-right font-medium">{lineTotal != null ? formatPrice(lineTotal) : "—"}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("finalWeight")}</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={draft.finalWeightKg}
                onChange={(e) => updateDraft(item.id, "finalWeightKg", e.target.value)}
              />
              {item.warehouse_weight_kg != null &&
                draft.finalWeightKg === String(item.warehouse_weight_kg) && (
                  <p className="text-xs text-muted-foreground">{t("fromWarehouse")}</p>
                )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("finalPieces")}</Label>
              <Input
                type="number"
                step="1"
                min="0"
                placeholder={t("optional")}
                value={draft.finalPieces}
                onChange={(e) => updateDraft(item.id, "finalPieces", e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <Label className="text-xs">{t("pricePerKg")}</Label>
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
                    {t("marketToday", { price: formatPrice(hint) })}
                  </button>
                );
              })()}
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="space-y-1">
              {warnings.map((warning) => (
                <p key={warning.kind} className="rounded-md bg-amber-100 px-3 py-1.5 text-sm text-amber-800">
                  {tWarnings(warning.messageKey, warning.values)}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="sticky bottom-2 z-10 flex items-center gap-4 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur">
        <div className="shrink-0">
          <div className="text-xs text-muted-foreground">{t("runningTotal")}</div>
          <div className="text-xl font-bold tabular-nums">
            {allReady ? formatPrice(runningTotal) : "—"}
          </div>
        </div>
        <Button className="flex-1" size="lg" disabled={closing || !allReady} onClick={handleClose}>
          {closing ? t("closing") : t("closeOrder")}
        </Button>
      </div>
      {!allReady && (
        <p className="text-center text-xs text-muted-foreground">
          {t("enterToClose")}
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
  const t = useTranslations("orders.detail.closed");
  const tReopen = useTranslations("orders.dialogs.reopen");
  const tError = useTranslations("orders");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canReopen = callerRole === "owner" || callerRole === "org_admin";
  const nonCancelled = order.items.filter((item) => !item.is_cancelled);
  const format = useFormatter();

  async function handleReopen() {
    setSubmitting(true);
    const result = await reopenOrder(organizationSlug, order.id, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: tError("error"), description: result.messageKey ? tRoot(result.messageKey as never) : result.message, variant: "destructive" });
      return;
    }
    toast({ title: tReopen("reopenedToast") });
    setReopenOpen(false);
    onReload();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">{t("settlementSummary")}</h2>
        <div className="space-y-2">
          {nonCancelled.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>
                {item.product?.name ?? t("item")} —{" "}
                {item.final_weight_kg != null ? formatWeight(item.final_weight_kg) : "-"} @{" "}
                {item.price_per_kg != null ? formatPrice(item.price_per_kg) : "-"}/kg
              </span>
              <span className="font-medium">{item.line_total != null ? formatPrice(item.line_total) : "-"}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t pt-3 text-lg font-bold">
          <span>{t("total")}</span>
          <span>{formatPrice(order.total_amount)}</span>
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{t("weightLog")}</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colKind")}</TableHead>
              <TableHead>{t("colWeight")}</TableHead>
              <TableHead>{t("colPieces")}</TableHead>
              <TableHead>{t("colRecordedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(order.weight_log ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {t("noWeightLog")}
                </TableCell>
              </TableRow>
            ) : (
              order.weight_log!.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="capitalize">{t(`weightLogKind.${log.kind}`)}</TableCell>
                  <TableCell>{formatWeight(log.weight_kg)}</TableCell>
                  <TableCell>{log.pieces ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(new Date(log.recorded_at), { dateStyle: "medium", timeStyle: "short" })}
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
            <Button variant="outline">{t("reopenTrigger")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tReopen("title")}</DialogTitle>
              <DialogDescription>{tReopen("description")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label>{tReopen("reasonLabel")}</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tReopen("reasonPlaceholder")}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReopenOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button disabled={submitting} onClick={handleReopen}>
                {submitting ? tReopen("reopening") : tReopen("reopen")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
