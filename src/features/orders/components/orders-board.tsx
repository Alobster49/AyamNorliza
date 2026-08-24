"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { OrderListItem, OrderStatus, OrderWithItems } from "@/features/orders/types";
import { ORDER_STATUSES } from "@/features/orders/types";
import { resolveDrop } from "@/features/orders/lib/board-rules";
import { isAtRisk } from "@/features/orders/lib/board-view-model";
import { getOrderDetail, confirmOrder } from "@/features/orders/server/order-actions";
import { OrderCard, OrderCardContent } from "./order-card";
import {
  ConfirmOrderDialog,
  CancelOrderBoardDialog,
  ReopenOrderBoardDialog,
} from "./board-dialogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_DOT: Record<OrderStatus, string> = {
  pending: "bg-blue-500",
  confirmed: "bg-yellow-500",
  ready: "bg-green-500",
  delivered: "bg-purple-500",
  closed: "bg-gray-400",
  cancelled: "bg-red-500",
};

type PendingWorkflow =
  | { kind: "confirm"; orderId: string; detail: OrderWithItems }
  | { kind: "cancel"; orderId: string }
  | { kind: "reopen"; orderId: string };

type OrdersBoardProps = {
  organizationSlug: string;
  orders: OrderListItem[];
  callerRole: string;
  onOrdersChange: (orders: OrderListItem[]) => void;
  today: string;
};

export function OrdersBoard({
  organizationSlug,
  orders,
  callerRole,
  onOrdersChange,
  today,
}: OrdersBoardProps) {
  const router = useRouter();
  const t = useTranslations("orders.board");
  const tError = useTranslations("orders");
  const tRoot = useTranslations();
  const tStatus = useTranslations("status.order");
  const tCard = useTranslations("orders.card");
  const { toast } = useToast();
  const [activeOrder, setActiveOrder] = useState<OrderListItem | null>(null);
  const [workflow, setWorkflow] = useState<PendingWorkflow | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const sensors = useSensors(
    // Mouse keeps the quick 6px pickup.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch requires a 250ms hold so a scroll swipe stays a scroll.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space picks up / drops; Enter stays reserved for opening the order.
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );
  const detailFetchToken = useRef(0);

  const customerOf = (id: unknown) =>
    orders.find((o) => o.id === id)?.customer?.name ?? tCard("unknownCustomer");
  const columnOf = (id: unknown) => tStatus(String(id) as OrderStatus);

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("announce.pickedUp", { customer: customerOf(active.id) }),
    onDragOver: ({ over }) =>
      over ? t("announce.over", { column: columnOf(over.id) }) : undefined,
    onDragEnd: ({ over }) =>
      over ? t("announce.dropped", { column: columnOf(over.id) }) : t("announce.cancelled"),
    onDragCancel: () => t("announce.cancelled"),
  };

  const cardAriaLabel = (order: OrderListItem) =>
    t("cardAria", {
      customer: order.customer?.name ?? tCard("unknownCustomer"),
      status: tStatus(order.status),
    });

  const cardRisk = (order: OrderListItem) => isAtRisk(order, today);

  function moveOrder(orderId: string, to: OrderStatus) {
    onOrdersChange(orders.map((o) => (o.id === orderId ? { ...o, status: to } : o)));
    router.refresh();
  }

  async function quickConfirm(orderId: string) {
    if (confirmingId) return;
    setConfirmingId(orderId);
    try {
      const detail = await getOrderDetail(organizationSlug, orderId);
      if (!detail.ok) {
        toast({
          title: tError("error"),
          description: detail.messageKey ? tRoot(detail.messageKey as never) : detail.message,
          variant: "destructive",
        });
        return;
      }
      const result = await confirmOrder({
        organizationSlug,
        orderId,
        decisions: detail.data.items.map((item) => ({ itemId: item.id, available: true })),
      });
      if (!result.ok) {
        toast({
          title: tError("error"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("quickConfirm.success") });
      moveOrder(orderId, "confirmed");
    } finally {
      setConfirmingId(null);
    }
  }

  async function bulkConfirm() {
    setBulkBusy(true);
    let confirmed = 0;
    let failed = 0;
    try {
      for (const orderId of selected) {
        const detail = await getOrderDetail(organizationSlug, orderId);
        if (!detail.ok) {
          failed += 1;
          continue;
        }
        const result = await confirmOrder({
          organizationSlug,
          orderId,
          decisions: detail.data.items.map((item) => ({ itemId: item.id, available: true })),
        });
        if (result.ok) confirmed += 1;
        else failed += 1;
      }
      toast({
        title: t("bulk.summary", { confirmed, failed }),
        variant: failed > 0 ? "destructive" : undefined,
      });
    } finally {
      setBulkBusy(false);
      setSelectMode(false);
      setSelected(new Set());
      router.refresh();
    }
  }

  const cardActions = (order: OrderListItem) =>
    order.status === "pending" ? (
      <Button
        size="sm"
        variant="outline"
        className="h-8 w-full"
        disabled={confirmingId === order.id}
        onClick={(e) => {
          e.stopPropagation();
          quickConfirm(order.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {confirmingId === order.id ? t("quickConfirm.busy") : t("quickConfirm.action")}
      </Button>
    ) : undefined;

  function handleDragStart(event: DragStartEvent) {
    setActiveOrder(orders.find((o) => o.id === event.active.id) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveOrder(null);
    const { active, over } = event;
    if (!over) return;
    if (workflow !== null) return; // a drop while a workflow is pending is ignored

    const order = orders.find((o) => o.id === active.id);
    if (!order) return;
    if (confirmingId === order.id) return; // quick-confirm in flight for this card — ignore the drop
    const token = ++detailFetchToken.current;
    const to = over.id as OrderStatus;
    const resolution = resolveDrop(order.status, to, callerRole);

    switch (resolution.kind) {
      case "noop":
        return;
      case "blocked":
        toast({
          title: t("moveNotAllowedTitle"),
          description: tRoot(resolution.reasonKey as never),
          variant: "destructive",
        });
        return;
      case "settle":
        router.push(`/${organizationSlug}/orders/${order.id}`);
        return;
      case "cancel":
        setWorkflow({ kind: "cancel", orderId: order.id });
        return;
      case "reopen":
        setWorkflow({ kind: "reopen", orderId: order.id });
        return;
      case "confirm": {
        const result = await getOrderDetail(organizationSlug, order.id);
        if (token !== detailFetchToken.current) return; // a newer drag superseded this fetch
        if (!result.ok) {
          toast({
            title: tError("error"),
            description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
            variant: "destructive",
          });
          return;
        }
        setWorkflow({ kind: "confirm", orderId: order.id, detail: result.data });
        return;
      }
    }
  }

  return (
    <>
      <DndContext
        id="orders-board"
        sensors={sensors}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveOrder(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory sm:snap-none">
          {ORDER_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              orders={orders.filter((o) => o.status === status)}
              onOpenOrder={(id) => router.push(`/${organizationSlug}/orders/${id}`)}
              onNewOrder={() => router.push(`/${organizationSlug}/orders/new`)}
              cardAriaLabel={cardAriaLabel}
              cardRisk={cardRisk}
              cardActions={cardActions}
              headerExtra={
                status === "pending" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setSelectMode((v) => !v);
                      setSelected(new Set());
                    }}
                  >
                    {selectMode ? t("bulk.exit") : t("bulk.select")}
                  </Button>
                ) : undefined
              }
              renderSelectableCard={
                status === "pending" && selectMode
                  ? (order) => (
                      <label key={order.id} className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-3 h-4 w-4 accent-primary"
                          checked={selected.has(order.id)}
                          onChange={() => toggleSelected(order.id)}
                          aria-label={order.customer?.name ?? tCard("unknownCustomer")}
                        />
                        <div className="flex-1">
                          <OrderCardContent order={order} risk={cardRisk(order)} />
                        </div>
                      </label>
                    )
                  : undefined
              }
            />
          ))}
        </div>
        <DragOverlay>
          {activeOrder ? (
            <div className="w-72 rotate-2 opacity-90">
              <OrderCardContent order={activeOrder} risk={null} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectMode && selected.size > 0 && (
        <div className="sticky bottom-4 z-10 flex justify-center">
          <Button disabled={bulkBusy} onClick={bulkConfirm} className="shadow-lg">
            {t("bulk.confirmN", { count: selected.size })}
          </Button>
        </div>
      )}

      <ConfirmOrderDialog
        open={workflow?.kind === "confirm"}
        onOpenChange={(open) => !open && setWorkflow(null)}
        organizationSlug={organizationSlug}
        order={workflow?.kind === "confirm" ? workflow.detail : null}
        onDone={async () => {
          if (!workflow) return;
          try {
            const result = await getOrderDetail(organizationSlug, workflow.orderId);
            if (result.ok) {
              moveOrder(workflow.orderId, result.data.status);
            } else {
              router.refresh();
            }
          } catch {
            router.refresh();
          }
        }}
      />
      <CancelOrderBoardDialog
        open={workflow?.kind === "cancel"}
        onOpenChange={(open) => !open && setWorkflow(null)}
        organizationSlug={organizationSlug}
        orderId={workflow?.kind === "cancel" ? workflow.orderId : ""}
        onDone={() => workflow && moveOrder(workflow.orderId, "cancelled")}
      />
      <ReopenOrderBoardDialog
        open={workflow?.kind === "reopen"}
        onOpenChange={(open) => !open && setWorkflow(null)}
        organizationSlug={organizationSlug}
        orderId={workflow?.kind === "reopen" ? workflow.orderId : ""}
        onDone={() => workflow && moveOrder(workflow.orderId, "delivered")}
      />
    </>
  );
}

function BoardColumn({
  status,
  orders,
  onOpenOrder,
  onNewOrder,
  cardAriaLabel,
  cardRisk,
  cardActions,
  headerExtra,
  renderSelectableCard,
}: {
  status: OrderStatus;
  orders: OrderListItem[];
  onOpenOrder: (id: string) => void;
  onNewOrder: () => void;
  cardAriaLabel: (order: OrderListItem) => string;
  cardRisk: (order: OrderListItem) => "overdue" | "dueToday" | null;
  cardActions: (order: OrderListItem) => React.ReactNode;
  headerExtra?: React.ReactNode;
  renderSelectableCard?: (order: OrderListItem) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const t = useTranslations("orders.board");
  const tStatus = useTranslations("status.order");
  const statusLabel = tStatus(status);

  return (
    <section
      ref={setNodeRef}
      aria-label={statusLabel}
      className={
        "flex h-[calc(100vh-10rem)] w-72 shrink-0 snap-center flex-col rounded-xl border bg-muted/40 " +
        (isOver ? "ring-2 ring-primary/40" : "")
      }
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
        <h3 className="text-sm font-semibold">{statusLabel}</h3>
        <Badge variant="secondary" className="text-[10px]">
          {orders.length}
        </Badge>
        {headerExtra}
        {status === "pending" && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-9 w-9"
            onClick={onNewOrder}
            aria-label={t("addToPending")}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {orders.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {t(`empty.${status}`)}
          </div>
        ) : (
          orders.map((order) =>
            renderSelectableCard ? (
              renderSelectableCard(order)
            ) : (
              <OrderCard
                key={order.id}
                order={order}
                onOpen={() => onOpenOrder(order.id)}
                ariaLabel={cardAriaLabel(order)}
                risk={cardRisk(order)}
                actions={cardActions(order)}
              />
            ),
          )
        )}
      </div>
      {status === "pending" && (
        <footer className="px-2 pb-2">
          <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={onNewOrder}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            {t("newOrder")}
          </Button>
        </footer>
      )}
    </section>
  );
}
