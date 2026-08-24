"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import type { BoardTruck } from "../lib/dispatch-board-model";
import { Button } from "@/components/ui/button";
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
        // 300ms only while sliding out (the board delays its refetch to match);
        // drop-target and dim feedback stays at 150ms so hover feels immediate.
        "rounded-lg border bg-background p-3 transition-all motion-reduce:transition-none",
        departing ? "duration-300" : "duration-150",
        highlight ? "border-green-500 ring-2 ring-green-500/30" : "",
        dim ? "opacity-50" : "",
        isOver ? "border-primary/50 bg-accent ring-2 ring-primary/30" : "",
        departing ? "translate-x-full opacity-0" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-semibold">{truck.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{truck.code}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {load}
            {cap !== null ? `/${cap}` : ""}
          </span>
          <Button size="xs" onClick={onDepart} disabled={!canDepart}>
            {t("depart")}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex min-h-16 flex-col gap-2">
        {tickets.map((t) => (
          <TicketCard key={t.id} ticket={t} />
        ))}
        {tickets.length === 0 ? (
          <div
            className={`rounded-md border border-dashed p-2 text-center text-xs transition-colors duration-150 ${
              isOver ? "border-primary/50 text-foreground" : "text-muted-foreground"
            }`}
          >
            {t("dropHere")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
