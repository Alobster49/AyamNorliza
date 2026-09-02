"use client";

import { useDroppable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import type { BoardTruck } from "../lib/dispatch-board-model";
import type { TruckDuty } from "../lib/roster-model";
import { Button } from "@/components/ui/button";
import { TicketCard } from "./ticket-card";

/**
 * Who is driving this truck today. A truck the roster has a gap for says so in
 * red: without this the office can plan and load a truck nobody drives, and
 * nothing tells them until the morning it doesn't leave.
 */
export function DriverLine({ duty, className = "" }: { duty: TruckDuty | null | undefined; className?: string }) {
  const t = useTranslations("logistics.dispatch.driver");
  if (!duty) return null;
  if (duty.driverId) {
    return <span className={`block truncate text-xs text-muted-foreground ${className}`}>{t("label")} · {duty.driverName}</span>;
  }
  // `flex` + `min-w-0` so the label keeps one line and only the "who is away"
  // tail truncates -- these sit in plan cards barely wider than the sentence.
  return (
    <span className={`flex min-w-0 items-center gap-1 text-xs font-medium text-destructive ${className}`} title={t("noneTitle")}>
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="shrink-0">{t("none")}</span>
      {duty.absentName ? <span className="truncate font-normal">· {t("away", { name: duty.absentName })}</span> : null}
    </span>
  );
}

export function TruckCard({
  boardTruck,
  duty,
  highlight,
  dim,
  departing,
  onDepart,
  canDepart,
}: {
  boardTruck: BoardTruck;
  duty: TruckDuty | null;
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
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-semibold">{truck.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{truck.code}</span>
          </div>
          <DriverLine duty={duty} />
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
