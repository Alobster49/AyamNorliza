"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ORDER_STATUSES, ORDER_STATUS_DOT } from "@/features/orders/types";
import { resolveDrop } from "@/features/orders/lib/board-rules";
import { classifyDropTarget, isAtRisk, type DropTarget } from "@/features/orders/lib/board-view-model";
import { getOrderDetail } from "@/features/orders/server/order-actions";
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

type PendingWorkflow =
  | { kind: "confirm"; orderId: string; detail: OrderWithItems }
  | { kind: "cancel"; orderId: string }
  | { kind: "reopen"; orderId: string };

type OrdersBoardProps = {
  organizationSlug: string;
  orders: OrderListItem[];
  canReopen: boolean;
  onOrderStatusChange: (orderId: string, status: OrderStatus) => void;
  today: string;
};

export function OrdersBoard({
  organizationSlug,
  orders,
  canReopen,
  onOrderStatusChange,
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
  const [refusedId, setRefusedId] = useState<string | null>(null);
  const refuseFallbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pagerRef = useRef<HTMLElement | null>(null);
  const chipRefs = useRef(new Map<OrderStatus, HTMLButtonElement>());
  const columnRefs = useRef(new Map<OrderStatus, HTMLElement>());
  const [activeColumn, setActiveColumn] = useState<OrderStatus>(ORDER_STATUSES[0]);

  const countByStatus = useMemo(() => {
    const base = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const order of orders) base[order.status] += 1;
    return base;
  }, [orders]);

  const registerColumn = useCallback((status: OrderStatus, node: HTMLElement | null) => {
    if (node) columnRefs.current.set(status, node);
    else columnRefs.current.delete(status);
  }, []);

  // Whichever column sits closest to the scroller's left edge owns the pager.
  function syncActiveColumn() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // offsetLeft is measured against the nearest positioned ancestor, which is not
    // this scroller — compare live rects instead.
    const origin = scroller.getBoundingClientRect().left;
    let nearest: OrderStatus = ORDER_STATUSES[0];
    let best = Infinity;
    for (const status of ORDER_STATUSES) {
      const node = columnRefs.current.get(status);
      if (!node) continue;
      const distance = Math.abs(node.getBoundingClientRect().left - origin);
      if (distance < best) {
        best = distance;
        nearest = status;
      }
    }
    setActiveColumn((prev) => (prev === nearest ? prev : nearest));
  }

  // Keep the current chip on screen — swiping to Cancelled must not leave the
  // pager showing Pending. Scrolls the pager only, never the page.
  useEffect(() => {
    const pager = pagerRef.current;
    const chip = chipRefs.current.get(activeColumn);
    if (!pager || !chip) return;
    const chipRect = chip.getBoundingClientRect();
    const pagerRect = pager.getBoundingClientRect();
    if (chipRect.left < pagerRect.left) {
      pager.scrollTo({ left: pager.scrollLeft + chipRect.left - pagerRect.left - 4, behavior: "smooth" });
    } else if (chipRect.right > pagerRect.right) {
      pager.scrollTo({ left: pager.scrollLeft + chipRect.right - pagerRect.right + 4, behavior: "smooth" });
    }
  }, [activeColumn]);

  function jumpToColumn(status: OrderStatus) {
    const scroller = scrollerRef.current;
    const node = columnRefs.current.get(status);
    if (!scroller || !node) return;
    setActiveColumn(status);
    const delta = node.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    scroller.scrollTo({ left: scroller.scrollLeft + delta, behavior: "smooth" });
  }

  function clearRefuseFallback() {
    if (refuseFallbackTimeout.current) {
      clearTimeout(refuseFallbackTimeout.current);
      refuseFallbackTimeout.current = null;
    }
  }

  function onRefuseEnd() {
    clearRefuseFallback();
    setRefusedId(null);
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
    onDragEnd: ({ active, over }) => {
      const o = orders.find((x) => x.id === active.id);
      if (over && o && classifyDropTarget(o.status, over.id as OrderStatus, canReopen).mode === "decline") {
        return t("moveNotAllowedTitle");
      }
      return over ? t("announce.dropped", { column: columnOf(over.id) }) : t("announce.cancelled");
    },
    onDragCancel: () => t("announce.cancelled"),
  };

  const cardAriaLabel = (order: OrderListItem) =>
    t("cardAria", {
      customer: order.customer?.name ?? tCard("unknownCustomer"),
      status: tStatus(order.status),
    });

  const cardRisk = (order: OrderListItem) => isAtRisk(order, today);

  function moveOrder(orderId: string, to: OrderStatus) {
    onOrderStatusChange(orderId, to);
    router.refresh();
  }

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
    const to = over.id as OrderStatus;
    const resolution = resolveDrop(order.status, to, canReopen);

    switch (resolution.kind) {
      case "noop":
        return;
      case "blocked":
        clearRefuseFallback();
        setRefusedId(order.id);
        // Reduced-motion users get no animationend from the shake, so fall back to a timer.
        refuseFallbackTimeout.current = setTimeout(onRefuseEnd, 400);
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
        const token = ++detailFetchToken.current;
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
        {/* Phone: six columns are six swipes away — the pager makes them one tap,
            and marks where you are. Hidden once the columns fit side by side. */}
        <nav
          ref={pagerRef}
          aria-label={t("columnNav")}
          className="-mx-1 mb-1.5 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:hidden"
        >
          {ORDER_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              ref={(node) => {
                if (node) chipRefs.current.set(status, node);
                else chipRefs.current.delete(status);
              }}
              onClick={() => jumpToColumn(status)}
              aria-current={activeColumn === status ? "true" : undefined}
              className={
                "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors " +
                (activeColumn === status
                  ? "border-transparent bg-foreground text-background"
                  : "bg-card text-muted-foreground")
              }
            >
              <span className={`h-1.5 w-1.5 rounded-full ${ORDER_STATUS_DOT[status]}`} />
              {tStatus(status)}
              <span className="tabular-nums opacity-70">{countByStatus[status]}</span>
            </button>
          ))}
        </nav>
        <p className="mb-1.5 px-1 text-[11px] text-muted-foreground sm:hidden">{t("dragHint")}</p>
        <div
          ref={scrollerRef}
          onScroll={syncActiveColumn}
          className="flex h-full gap-3 overflow-x-auto pb-4 snap-x snap-mandatory sm:gap-4 sm:snap-none"
        >
          {ORDER_STATUSES.map((status) => {
            const dropTarget = activeOrder
              ? classifyDropTarget(activeOrder.status, status, canReopen)
              : null;
            return (
              <BoardColumn
                key={status}
                status={status}
                registerRef={registerColumn}
                orders={orders.filter((o) => o.status === status)}
                onOpenOrder={(id) => router.push(`/${organizationSlug}/orders/${id}`)}
                onNewOrder={() => router.push(`/${organizationSlug}/orders/new`)}
                cardAriaLabel={cardAriaLabel}
                cardRisk={cardRisk}
                dropTarget={dropTarget}
                hintText={dropTarget?.hintKey ? tRoot(dropTarget.hintKey as never) : null}
                refusedId={refusedId}
                onRefuseEnd={onRefuseEnd}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={{ duration: 250, easing: "cubic-bezier(0.77, 0, 0.175, 1)" }}>
          {activeOrder ? (
            // Decorative drag preview — its links/buttons must not be reachable by AT or clicks.
            <div className="pointer-events-none w-72 rotate-2 scale-105 rounded-lg shadow-2xl" aria-hidden="true">
              <OrderCardContent order={activeOrder} risk={null} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
  registerRef,
  orders,
  onOpenOrder,
  onNewOrder,
  cardAriaLabel,
  cardRisk,
  dropTarget,
  hintText,
  refusedId,
  onRefuseEnd,
}: {
  status: OrderStatus;
  registerRef: (status: OrderStatus, node: HTMLElement | null) => void;
  orders: OrderListItem[];
  onOpenOrder: (id: string) => void;
  onNewOrder: () => void;
  cardAriaLabel: (order: OrderListItem) => string;
  cardRisk: (order: OrderListItem) => "overdue" | "dueToday" | null;
  dropTarget: DropTarget | null;
  hintText: string | null;
  refusedId: string | null;
  onRefuseEnd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const t = useTranslations("orders.board");
  const tStatus = useTranslations("status.order");
  const statusLabel = tStatus(status);

  return (
    <section
      ref={(node) => {
        setNodeRef(node);
        registerRef(status, node);
      }}
      aria-label={statusLabel}
      className={
        "flex h-full w-[82vw] max-w-[19rem] shrink-0 snap-start flex-col rounded-xl border bg-muted/40 sm:w-72 sm:max-w-none sm:snap-align-none " +
        "transition-[opacity,transform,box-shadow] duration-150 motion-reduce:transition-none " +
        (dropTarget?.mode === "invite"
          ? isOver
            ? "ring-2 ring-primary bg-primary/10 scale-[1.01] "
            : "ring-2 ring-primary/50 bg-primary/5 "
          : dropTarget?.mode === "decline"
            ? "border-dashed "
            : isOver
              ? "ring-2 ring-primary/40 "
              : "")
      }
    >
      <header className="flex items-center gap-2 px-3 py-2 sm:py-2.5">
        <span className={`h-2 w-2 rounded-full ${ORDER_STATUS_DOT[status]}`} />
        <h3 className="text-sm font-semibold">{statusLabel}</h3>
        <Badge key={orders.length} variant="secondary" className="animate-count-pop text-[10px]">
          {orders.length}
        </Badge>
        {dropTarget?.mode === "decline" && hintText ? (
          <span className="ml-auto text-[10px] font-medium text-foreground/80">{hintText}</span>
        ) : (
          status === "pending" && (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8 sm:h-5 sm:w-5"
              onClick={onNewOrder}
              aria-label={t("addToPending")}
            >
              <Plus className="h-4 w-4 sm:h-2.5 sm:w-2.5" />
            </Button>
          )
        )}
      </header>
      <div
        className={
          "flex-1 space-y-2 overflow-y-auto px-2 pb-2 " +
          (dropTarget?.mode === "decline" ? "opacity-50 saturate-50" : "")
        }
      >
        {orders.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {t(`empty.${status}`)}
          </div>
        ) : (
          orders.map((order, index) => (
            <div
              key={order.id}
              className="animate-board-card-enter"
              style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
            >
              <OrderCard
                order={order}
                onOpen={() => onOpenOrder(order.id)}
                ariaLabel={cardAriaLabel(order)}
                risk={cardRisk(order)}
                refused={refusedId === order.id}
                onRefuseEnd={onRefuseEnd}
              />
            </div>
          ))
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
