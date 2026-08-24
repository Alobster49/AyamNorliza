"use client";

import { useDraggable } from "@dnd-kit/core";
import { useTranslations, useFormatter } from "next-intl";
import type { OrderListItem } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { displayAmount } from "@/features/orders/lib/board-view-model";
import { Badge } from "@/components/ui/badge";

/** Presentational card body — shared by the board card and the DragOverlay preview. */
export function OrderCardContent({ order }: { order: OrderListItem }) {
  const t = useTranslations("orders.card");
  const format = useFormatter();
  const formatDate = (date: string) =>
    format.dateTime(new Date(date), { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}</span>
        <Badge variant="outline" className="text-[10px] capitalize">
          {t(`source.${order.source}`)}
        </Badge>
      </div>
      <div className="text-sm font-medium leading-snug">{order.customer?.name ?? t("unknownCustomer")}</div>
      {order.notes && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{order.notes}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {order.zone?.name && (
          <Badge variant="secondary" className="text-[10px]">
            {order.zone.name}
          </Badge>
        )}
        <Badge variant="secondary" className="text-[10px]">
          {formatDate(order.delivery_date)}
        </Badge>
        {(() => {
          const amount = displayAmount(order);
          if (amount.kind === "none") return null;
          return amount.kind === "total" ? (
            <span className="ml-auto text-xs font-semibold">{formatPrice(amount.amount)}</span>
          ) : (
            <span className="ml-auto text-[10px] italic text-muted-foreground">{t("unweighed")}</span>
          );
        })()}
      </div>
    </div>
  );
}

export function OrderCard({
  order,
  onOpen,
  ariaLabel,
}: {
  order: OrderListItem;
  onOpen: () => void;
  ariaLabel: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: order.id,
    data: { status: order.status },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={ariaLabel}
      className={
        "cursor-grab [touch-action:pan-y] active:cursor-grabbing " + (isDragging ? "opacity-40" : "")
      }
    >
      <OrderCardContent order={order} />
    </div>
  );
}
