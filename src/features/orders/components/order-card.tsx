"use client";

import { useDraggable } from "@dnd-kit/core";
import { useTranslations, useFormatter } from "next-intl";
import { Phone, MessageCircle } from "lucide-react";
import type { OrderListItem } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { displayAmount, waLink } from "@/features/orders/lib/board-view-model";
import { Badge } from "@/components/ui/badge";

/** Presentational card body — shared by the board card and the DragOverlay preview. */
export function OrderCardContent({
  order,
  risk,
  actions,
}: {
  order: OrderListItem;
  risk?: "overdue" | "dueToday" | null;
  actions?: React.ReactNode;
}) {
  const t = useTranslations("orders.card");
  const tList = useTranslations("orders.client");
  const format = useFormatter();
  const formatDate = (date: string) =>
    format.dateTime(new Date(date), { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div
      className={`space-y-2 rounded-lg border bg-card p-3 shadow-sm ${
        risk === "overdue"
          ? "border-l-4 border-l-red-500"
          : risk === "dueToday"
            ? "border-l-4 border-l-amber-500"
            : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}</span>
        <div className="flex items-center gap-0.5">
          <Badge variant="outline" className="text-[10px] capitalize">
            {t(`source.${order.source}`)}
          </Badge>
          {order.customer?.phone && (
            <span className="flex items-center gap-0.5">
              <a
                href={`tel:${order.customer.phone}`}
                aria-label={t("call", { name: order.customer.name })}
                className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Phone className="h-3.5 w-3.5" />
              </a>
              <a
                href={waLink(order.customer.phone)}
                target="_blank"
                rel="noreferrer"
                aria-label={t("whatsapp", { name: order.customer.name })}
                className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </a>
            </span>
          )}
        </div>
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
        {risk && (
          <Badge variant="destructive" className="text-[10px]">
            {tList(`atRisk.${risk}`)}
          </Badge>
        )}
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
      {actions && <div className="pt-1">{actions}</div>}
    </div>
  );
}

export function OrderCard({
  order,
  onOpen,
  ariaLabel,
  risk,
  actions,
}: {
  order: OrderListItem;
  onOpen: () => void;
  ariaLabel: string;
  risk?: "overdue" | "dueToday" | null;
  actions?: React.ReactNode;
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
        // Mid-keyboard-drag Enter must not navigate away — Space/Escape end the drag.
        if (e.key === "Enter" && !isDragging) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={ariaLabel}
      className={
        "cursor-grab [touch-action:pan-y] active:cursor-grabbing " + (isDragging ? "opacity-40" : "")
      }
    >
      <OrderCardContent order={order} risk={risk} actions={actions} />
    </div>
  );
}
