"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";
import {
  groupQueueByTask,
  queueWithPendingRemovals,
  type WeighLine,
  type WeighState,
} from "../lib/weigh-model";

type QueueRailProps = {
  queue: WeighLine[];
  confirmed: Record<string, true>;
  cursor: number;
  pendingRemovals: WeighState["pendingRemovals"];
  onSelect: (index: number) => void;
};

/**
 * Kiosk left rail: today's orders grouped by task, with per-order progress
 * and the current line highlighted. Clicking a row jumps the station there.
 * Orders mid-save stay visible as non-interactive rows with a spinner until
 * the server confirms, so completing one never makes it silently vanish.
 */
export function QueueRail({ queue, confirmed, cursor, pendingRemovals, onSelect }: QueueRailProps) {
  const t = useTranslations("orders.queue");
  const displayQueue = queueWithPendingRemovals(queue, pendingRemovals);
  const groups = groupQueueByTask(displayQueue);
  const currentLine = queue[cursor];
  const remaining = groups.filter(
    (g) => !pendingRemovals[g.taskId] && !g.lines.every((l) => confirmed[l.itemId]),
  ).length;
  const doneLines = displayQueue.filter(
    (l) => confirmed[l.itemId] || pendingRemovals[l.taskId],
  ).length;

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r">
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("left", { count: remaining })}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${displayQueue.length ? (doneLines / displayQueue.length) * 100 : 0}%` }}
          />
        </div>
      </div>
      {groups.map((group) => {
        const doneCount = group.lines.filter((l) => confirmed[l.itemId]).length;
        const isCurrent = currentLine?.taskId === group.taskId;
        const allDone = doneCount === group.lines.length;
        const saving = Boolean(pendingRemovals[group.taskId]);
        const firstIndex = queue.findIndex((l) => l.taskId === group.taskId);

        const rowContent = (
          <>
            <span className="flex items-center justify-between gap-2 text-sm font-medium">
              <span className="truncate">{group.customerName}</span>
              {saving ? (
                <Loader2
                  className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                  aria-label={t("saving")}
                />
              ) : (
                allDone && <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {group.truckCode} ·{" "}
              {saving
                ? t("saving")
                : isCurrent && currentLine
                  ? t("itemProgress", { index: currentLine.indexInTask, total: currentLine.totalInTask })
                  : t("weighedProgress", { done: doneCount, total: group.lines.length })}
            </span>
          </>
        );

        if (saving) {
          return (
            <div
              key={group.taskId}
              className="flex flex-col gap-0.5 border-l-2 border-transparent px-4 py-2.5 text-left opacity-60"
            >
              {rowContent}
            </div>
          );
        }
        return (
          <button
            key={group.taskId}
            type="button"
            onClick={() => onSelect(isCurrent ? cursor : firstIndex)}
            className={cn(
              "flex flex-col gap-0.5 border-l-2 border-transparent px-4 py-2.5 text-left transition-colors duration-150 motion-reduce:transition-none",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              isCurrent && "border-l-primary bg-accent",
              allDone && !isCurrent && "opacity-45",
            )}
          >
            {rowContent}
          </button>
        );
      })}
    </aside>
  );
}
