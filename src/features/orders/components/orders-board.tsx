"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { OrderListItem, OrderStatus, OrderWithItems } from "@/features/orders/types";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/features/orders/types";
import { resolveDrop } from "@/features/orders/lib/board-rules";
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
};

export function OrdersBoard({ organizationSlug, orders, callerRole, onOrdersChange }: OrdersBoardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [activeOrder, setActiveOrder] = useState<OrderListItem | null>(null);
  const [workflow, setWorkflow] = useState<PendingWorkflow | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function moveOrder(orderId: string, to: OrderStatus) {
    onOrdersChange(orders.map((o) => (o.id === orderId ? { ...o, status: to } : o)));
    router.refresh();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveOrder(orders.find((o) => o.id === event.active.id) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveOrder(null);
    const { active, over } = event;
    if (!over) return;

    const order = orders.find((o) => o.id === active.id);
    if (!order) return;
    const to = over.id as OrderStatus;
    const resolution = resolveDrop(order.status, to, callerRole);

    switch (resolution.kind) {
      case "noop":
        return;
      case "blocked":
        toast({ title: "Move not allowed", description: resolution.reason, variant: "destructive" });
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
        if (!result.ok) {
          toast({ title: "Error", description: result.message, variant: "destructive" });
          return;
        }
        setWorkflow({ kind: "confirm", orderId: order.id, detail: result.data });
        return;
      }
    }
  }

  return (
    <>
      <DndContext id="orders-board" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveOrder(null)}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {ORDER_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              orders={orders.filter((o) => o.status === status)}
              onOpenOrder={(id) => router.push(`/${organizationSlug}/orders/${id}`)}
              onNewOrder={() => router.push(`/${organizationSlug}/orders/new`)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeOrder ? (
            <div className="w-72 rotate-2 opacity-90">
              <OrderCardContent order={activeOrder} />
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
          const result = await getOrderDetail(organizationSlug, workflow.orderId);
          if (result.ok) {
            moveOrder(workflow.orderId, result.data.status);
          } else {
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
}: {
  status: OrderStatus;
  orders: OrderListItem[];
  onOpenOrder: (id: string) => void;
  onNewOrder: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={ORDER_STATUS_LABELS[status]}
      className={
        "flex h-[calc(100vh-16rem)] w-72 shrink-0 flex-col rounded-xl border bg-muted/40 " +
        (isOver ? "ring-2 ring-primary/40" : "")
      }
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
        <h3 className="text-sm font-semibold">{ORDER_STATUS_LABELS[status]}</h3>
        <Badge variant="secondary" className="text-[10px]">
          {orders.length}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          onClick={onNewOrder}
          aria-label={`Add order to ${ORDER_STATUS_LABELS[status]}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {orders.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No orders
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard key={order.id} order={order} onOpen={() => onOpenOrder(order.id)} />
          ))
        )}
      </div>
      <footer className="px-2 pb-2">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" size="sm" onClick={onNewOrder}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          New order
        </Button>
      </footer>
    </section>
  );
}
