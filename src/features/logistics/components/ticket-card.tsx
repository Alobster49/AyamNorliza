"use client";

import { useDraggable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { ORDER_STATUS_COLORS } from "@/features/orders/types";
import type { DispatchTicket } from "../types";

export function TicketCard({
  ticket,
  disabled,
  overlay = false,
}: {
  ticket: DispatchTicket;
  disabled?: boolean;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticket.id,
    disabled,
  });
  const t = useTranslations("logistics.dispatch");
  const tStatus = useTranslations("status.order");

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : { ...attributes, ...listeners })}
      className={[
        "rounded-md border bg-card p-2 text-sm shadow-sm",
        disabled ? "opacity-60" : "cursor-grab active:cursor-grabbing",
        isDragging && !overlay ? "opacity-40" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{ticket.customer?.name ?? t("customerFallback")}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${ORDER_STATUS_COLORS[ticket.status]}`}>
          {tStatus(ticket.status)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {ticket.zone?.name ? <span className="rounded bg-muted px-1.5 py-0.5">{ticket.zone.name}</span> : null}
        <span>{ticket.postcode ?? t("ticket.noPostcode")}</span>
        {ticket.assignment_source !== "none" ? (
          <span className="rounded bg-muted px-1.5 py-0.5">
            {ticket.assignment_source === "auto" ? t("ticket.auto") : t("ticket.manual")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
