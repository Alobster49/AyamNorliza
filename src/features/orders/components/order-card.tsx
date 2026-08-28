"use client";

import { useDraggable } from "@dnd-kit/core";
import { useTranslations, useFormatter } from "next-intl";
import type { OrderListItem } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { displayAmount } from "@/features/orders/lib/board-view-model";
import { Badge } from "@/components/ui/badge";

/** Presentational card body — shared by the board card and the DragOverlay preview. */
export function OrderCardContent({
  order,
  risk,
}: {
  order: OrderListItem;
  risk?: "overdue" | "dueToday" | null;
}) {
  const t = useTranslations("orders.card");
  const tList = useTranslations("orders.client");
  const format = useFormatter();
  const formatDate = (date: string) =>
    format.dateTime(new Date(date), { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div
      className={`space-y-1.5 rounded-lg border bg-card p-2.5 shadow-sm sm:space-y-2 sm:p-3 ${
        risk === "overdue" || risk === "dueToday"
          ? "border-l-4 border-l-[var(--status-cancelled)]"
          : ""
      }`}
    >
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
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5 sm:pt-1">
        {order.zone?.name && (
          <Badge variant="secondary" className="text-[10px]">
            {order.zone.name}
          </Badge>
        )}
        <Badge variant="secondary" className="text-[10px]">
          {formatDate(order.delivery_date)}
        </Badge>
        {risk === "overdue" ? (
          <Badge variant="destructive" className="text-[10px]">
            {tList(`atRisk.${risk}`)}
          </Badge>
        ) : risk === "dueToday" ? (
          <Badge
            variant="outline"
            className="border-transparent bg-[var(--status-confirmed-soft)] text-[var(--status-confirmed-text)] text-[10px]"
          >
            {tList(`atRisk.${risk}`)}
          </Badge>
        ) : null}
        {(() => {
          const amount = displayAmount(order);
          if (amount.kind === "total") {
            return (
              <span className="ml-auto text-sm font-semibold tabular-nums">
                {formatPrice(amount.amount)}
              </span>
            );
          }
          if (amount.kind === "unweighed") {
            return <span className="ml-auto text-xs text-muted-foreground">{t("unweighed")}</span>;
          }
          return null;
        })()}
      </div>
    </div>
  );
}

export function OrderCard({
  order,
  onOpen,
  ariaLabel,
  risk,
  refused,
  onRefuseEnd,
}: {
  order: OrderListItem;
  onOpen: () => void;
  ariaLabel: string;
  risk?: "overdue" | "dueToday" | null;
  refused: boolean;
  onRefuseEnd: () => void;
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
      onAnimationEnd={(e) => {
        // animationend bubbles — only react to this card's own refuse-shake.
        if (refused && e.animationName === "refuse-shake") onRefuseEnd();
      }}
      aria-label={ariaLabel}
      className={
        "cursor-grab rounded-lg board-card-lift [touch-action:pan-y] active:scale-[0.98] active:cursor-grabbing " +
        (isDragging
          ? "scale-[0.98] opacity-50 grayscale outline-dashed outline-2 outline-muted-foreground/30 "
          : "") +
        (refused ? " animate-refuse-shake" : "")
      }
    >
      <OrderCardContent order={order} risk={risk} />
    </div>
  );
}
