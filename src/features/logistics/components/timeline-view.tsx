"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import type { DispatchBoardData } from "../types";
import { buildTimeline, type BlockState } from "../lib/timeline-model";

const BLOCK_CLASS: Record<BlockState, string> = {
  ready: "border-green-600/40 bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  pending: "border-border bg-muted text-foreground",
  atRisk: "border-amber-600/40 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  late: "border-red-600/40 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  departed: "border-dashed border-border bg-muted/50 text-muted-foreground",
};

function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function useNowMinutes(date: string): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const compute = () =>
      setNow(date === localTodayIso() ? new Date().getHours() * 60 + new Date().getMinutes() : null);
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [date]);
  return now;
}

export function DayTimeline({ date, data }: { date: string; data: DispatchBoardData }) {
  const tEmpty = useTranslations("loadingBoard.empty");
  const t = useTranslations("logistics.dispatch.timeline");
  const tPlan = useTranslations("logistics.dispatch.plan");
  const tStatusRun = useTranslations("status.run");
  const nowMinutes = useNowMinutes(date);
  const view = useMemo(() => buildTimeline(data, date, nowMinutes), [data, date, nowMinutes]);

  const STATE_LABEL: Record<BlockState, string> = {
    ready: t("state.ready"),
    pending: t("state.pending"),
    atRisk: t("state.atRisk"),
    late: t("state.late"),
    departed: tStatusRun("departed"),
  };

  const atRiskCount = view.rows.flatMap((r) => r.blocks).filter((b) => b.state === "late" || b.state === "atRisk").length;

  // Phone agenda: all blocks across trucks, by time.
  const agenda = useMemo(
    () =>
      view.rows
        .flatMap((r) => r.blocks.map((b) => ({ ...b, truckName: r.truck.name })))
        .sort((a, b) => a.startMin - b.startMin),
    [view.rows],
  );

  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {fmt(view.windowStart)} — {fmt(view.windowEnd)}
        </span>
        {atRiskCount > 0 ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200">
            {t("atRiskBadge", { count: atRiskCount })}
          </span>
        ) : null}
        {view.poolCount > 0 ? <span>{t("unassignedNotice", { count: view.poolCount })}</span> : null}
      </div>

      {/* Desktop / tablet: trucks × hours grid */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <div className="min-w-[720px]">
          <div className="grid border-b bg-muted/50" style={{ gridTemplateColumns: `140px repeat(${view.hours.length - 1}, 1fr)` }}>
            <span className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("truckHeader")}</span>
            {view.hours.slice(0, -1).map((h) => (
              <span key={h} className="border-l px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {view.rows.map((row) => (
            <div key={row.truck.id} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: "140px 1fr" }}>
              <div className="border-r bg-muted/30 px-3 py-2">
                <p className="text-sm font-semibold">{row.truck.name}</p>
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {row.truck.code}
                  {row.loadKg > 0 ? ` · ${row.loadKg.toFixed(1)} kg` : ""}
                  {row.departed ? ` · ${tStatusRun("departed")}` : ""}
                </p>
              </div>
              <div className="relative" style={{ height: `${row.laneCount * 44 + 16}px` }}>
                {view.hours.slice(1, -1).map((h) => (
                  <span
                    key={h}
                    className="absolute inset-y-0 border-l"
                    style={{ left: `${(((h * 60 - view.windowStart) / (view.windowEnd - view.windowStart)) * 100).toFixed(3)}%` }}
                    aria-hidden
                  />
                ))}
                {row.blocks.map((b) => (
                  <div
                    key={b.ticket.id}
                    className={`absolute flex min-w-16 flex-col overflow-hidden rounded-md border px-2 py-1 ${BLOCK_CLASS[b.state]}`}
                    style={{
                      top: `${8 + b.lane * 44}px`,
                      height: "40px",
                      left: `${b.startPct}%`,
                      width: `${Math.min(Math.max(b.widthPct, 6), 100 - b.startPct)}%`,
                    }}
                    title={t("blockTitle", {
                      name: b.ticket.customer?.name ?? tPlan("orderFallback"),
                      time: fmt(b.startMin),
                      state: STATE_LABEL[b.state],
                    })}
                  >
                    <span className="truncate text-[11px] font-semibold">{b.ticket.customer?.name ?? tPlan("orderFallback")}</span>
                    <span className="truncate text-[10px] tabular-nums opacity-80">
                      {fmt(b.startMin)} · {STATE_LABEL[b.state]}
                    </span>
                  </div>
                ))}
                {view.nowPct !== null ? (
                  <span
                    className="absolute inset-y-0 w-0.5 bg-primary"
                    style={{ left: `${view.nowPct}%` }}
                    aria-label={t("now")}
                  />
                ) : null}
              </div>
            </div>
          ))}
          {view.rows.length === 0 ? (
            <HenEmptyState title={tEmpty("titleDate")} subtitle={tEmpty("subtitle")} className="py-10" />
          ) : null}
        </div>
      </div>

      {/* Phone: agenda grouped by start time */}
      <div className="flex flex-col gap-2 md:hidden">
        {agenda.map((b) => (
          <div key={b.ticket.id} className={`flex items-center gap-3 rounded-lg border p-3 ${BLOCK_CLASS[b.state]}`}>
            <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{fmt(b.startMin)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{b.ticket.customer?.name ?? tPlan("orderFallback")}</p>
              <p className="truncate text-xs opacity-80">
                {t("agendaRow", { truck: b.truckName, state: STATE_LABEL[b.state] })}
              </p>
            </div>
          </div>
        ))}
        {agenda.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("agendaEmpty")}</p>
        ) : null}
      </div>
    </div>
  );
}
