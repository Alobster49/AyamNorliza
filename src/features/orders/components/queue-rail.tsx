"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { groupQueueByTask, type WeighLine } from "../lib/weigh-model";

type QueueRailProps = {
  queue: WeighLine[];
  confirmed: Record<string, true>;
  cursor: number;
  syncingTaskIds: ReadonlySet<string>;
  onSelect: (index: number) => void;
};

/**
 * Kiosk left rail: today's orders grouped by task, with per-order progress
 * and the current line highlighted. Clicking a row jumps the station there.
 */
export function QueueRail({ queue, confirmed, cursor, syncingTaskIds, onSelect }: QueueRailProps) {
  const groups = groupQueueByTask(queue);
  const currentLine = queue[cursor];
  const remaining = groups.filter((g) => !g.lines.every((l) => confirmed[l.itemId])).length;

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r">
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Queue · {remaining} left
        </div>
      </div>
      {groups.map((group) => {
        const doneCount = group.lines.filter((l) => confirmed[l.itemId]).length;
        const isCurrent = currentLine?.taskId === group.taskId;
        const allDone = doneCount === group.lines.length;
        const syncing = syncingTaskIds.has(group.taskId);
        const firstIndex = queue.findIndex((l) => l.taskId === group.taskId);
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
            <span className="flex items-center justify-between gap-2 text-sm font-medium">
              <span className="truncate">{group.customerName}</span>
              {syncing && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Saving" />}
            </span>
            <span className="text-xs text-muted-foreground">
              {group.truckCode} ·{" "}
              {isCurrent && currentLine
                ? `item ${currentLine.indexInTask} of ${currentLine.totalInTask}`
                : `${doneCount} / ${group.lines.length} weighed`}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
