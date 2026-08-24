"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import type { BoardTruck } from "../lib/dispatch-board-model";
import { TicketCard } from "./ticket-card";

export function TruckCard({
  boardTruck,
  highlight,
  dim,
  departing,
  onDepart,
  canDepart,
}: {
  boardTruck: BoardTruck;
  highlight: boolean;
  dim: boolean;
  departing: boolean;
  onDepart: () => void;
  canDepart: boolean;
}) {
  const { truck, tickets, load, cap, departed } = boardTruck;
  const { setNodeRef, isOver } = useDroppable({ id: `truck:${truck.id}`, disabled: departed });
  const t = useTranslations("logistics.dispatch");

  if (departed && !departing) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
        <span className="font-medium">{truck.name}</span> — {t("onRoadWithOrders", { count: load })}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={[
        "rounded-lg border bg-background p-3 transition-all duration-300 motion-reduce:transition-none",
        highlight ? "border-green-500 ring-2 ring-green-500/30" : "",
        dim ? "opacity-50" : "",
        isOver ? "bg-accent" : "",
        departing ? "translate-x-full opacity-0" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{truck.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{truck.code}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {load}
            {cap !== null ? `/${cap}` : ""}
          </span>
          <button
            type="button"
            onClick={onDepart}
            disabled={!canDepart}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-40"
          >
            Depart
          </button>
        </div>
      </div>
      <div className="mt-2 flex min-h-16 flex-col gap-2">
        {tickets.map((t) => (
          <TicketCard key={t.id} ticket={t} />
        ))}
        {tickets.length === 0 ? (
          <div className="rounded border border-dashed p-2 text-center text-xs text-muted-foreground">
            Drop orders here
          </div>
        ) : null}
      </div>
    </div>
  );
}
