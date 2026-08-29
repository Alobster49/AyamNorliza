"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isLineReady,
  isTaskBlocked,
  isTaskMineActive,
  isTaskStartable,
  type LineDraft,
  type WeighAction,
  type WeighState,
} from "../lib/weigh-model";
import { OrderProgressTicks } from "./order-progress-ticks";
import { QueueRail } from "./queue-rail";
import { WarehouseEmptyState } from "./warehouse-empty-state";
import { SizeBandGauge } from "./size-band-gauge";
import { WeighNumpad } from "./weigh-numpad";
import { WeightReadout } from "./weight-readout";

const EMPTY_DRAFT: LineDraft = { weightKg: "", pieces: "" };

type WeighStationProps = {
  state: WeighState;
  dispatch: (action: WeighAction) => void;
  onStart: (taskId: string) => void;
  people: Record<string, string>;
  nowMs: number;
  onRelease: (taskId: string) => void;
  className?: string;
};

/**
 * Desktop/tablet kiosk: queue rail on the left, one line at a time on the
 * right with a scale-sized readout, size-band gauge and numpad.
 */
export function WeighStation({
  state,
  dispatch,
  onStart,
  people,
  nowMs,
  onRelease,
  className,
}: WeighStationProps) {
  const tDetail = useTranslations("orders.detail");
  const tQueue = useTranslations("orders.queue");
  const tStation = useTranslations("orders.station");
  const tSwipeCard = useTranslations("orders.swipeCard");
  const tNumpad = useTranslations("orders.numpad");
  const tTasks = useTranslations("tasks");
  const line = state.queue[state.cursor];
  const mineActive = line ? isTaskMineActive(state, line.taskId, nowMs) : false;
  const startable = line ? isTaskStartable(state, line.taskId, nowMs) : false;
  const blocked = line ? isTaskBlocked(state, line.taskId, nowMs) : false;

  return (
    <div className={cn("min-h-0 flex-1 overflow-hidden rounded-lg border", className)}>
      {line ? (
        <div className="flex h-full w-full min-w-0">
          <QueueRail
            queue={state.queue}
            confirmed={state.confirmed}
            cursor={state.cursor}
            pendingRemovals={state.pendingRemovals}
            claims={state.claims}
            viewerId={state.viewerId}
            people={people}
            nowMs={nowMs}
            onSelect={(index) => dispatch({ type: "GO_TO", index })}
            onRelease={onRelease}
          />
          {/* my-auto instead of justify-center: centered when it fits, but the top
              stays scroll-reachable when the viewport is short. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto p-8 [scrollbar-gutter:stable_both-edges]">
            <div className="my-auto flex w-full max-w-xl flex-col gap-8">
              {/* Remounts per line so each one enters with a quick rise-and-fade;
                  the numpad below stays put across lines. */}
              <div
                key={line.itemId}
                className="flex flex-col gap-8 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 motion-safe:ease-out"
              >
                <div className="flex flex-col gap-3">
                  <OrderProgressTicks
                    lines={state.queue.filter((l) => l.taskId === line.taskId)}
                    confirmed={state.confirmed}
                    currentItemId={line.itemId}
                  />
                  {blocked && (
                    <div className="mx-auto w-fit rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-500">
                      {(() => {
                        const by = state.claims[line.taskId]?.by;
                        const name = by ? people[by] : undefined;
                        return name ? tQueue("claimedBy", { name }) : tQueue("claimedByFallback");
                      })()}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h1 className="truncate text-2xl font-semibold">{line.customerName}</h1>
                      <p className="font-mono text-xs text-muted-foreground">
                        {tDetail("heading", { id: line.orderIdShort })} ·{" "}
                        {tQueue("itemProgress", { index: line.indexInTask, total: line.totalInTask })}
                        {line.slotWindow &&
                          tStation("slotSuffix", { start: line.slotWindow.start, end: line.slotWindow.end })}
                      </p>
                    </div>
                    <Badge variant="secondary">{line.truckCode}</Badge>
                  </div>
                </div>

                <div>
                  <div className="text-xl font-medium">{line.productName}</div>
                  <div className="text-sm text-muted-foreground">
                    {line.mode === "kg"
                      ? tSwipeCard("orderedKg", {
                          quantity: line.orderedQuantity,
                          min: line.sizeMinKg,
                          max: line.sizeMaxKg,
                        })
                      : tSwipeCard("orderedPieces", {
                          quantity: line.orderedQuantity,
                          min: line.sizeMinKg,
                          max: line.sizeMaxKg,
                        })}
                  </div>
                </div>

                <WeightReadout
                  weightKg={(state.drafts[line.itemId] ?? EMPTY_DRAFT).weightKg}
                  pieces={(state.drafts[line.itemId] ?? EMPTY_DRAFT).pieces}
                  entryTarget={state.entryTarget}
                  size="kiosk"
                />

                <SizeBandGauge line={line} draft={state.drafts[line.itemId] ?? EMPTY_DRAFT} />
              </div>

              {mineActive && (
                <WeighNumpad
                  variant="kiosk"
                  entryTarget={state.entryTarget}
                  nextDisabled={!isLineReady(line, state.drafts)}
                  onDigit={(digit) => dispatch({ type: "DIGIT", digit })}
                  onDot={() => dispatch({ type: "DOT" })}
                  onBackspace={() => dispatch({ type: "BACKSPACE" })}
                  onToggleTarget={() => dispatch({ type: "TOGGLE_TARGET" })}
                  onNext={() => dispatch({ type: "NEXT", nowMs: Date.now() })}
                  onSkip={() => dispatch({ type: "SKIP", nowMs: Date.now() })}
                />
              )}

              {startable && (
                <Button
                  type="button"
                  size="lg"
                  className="h-16 w-full max-w-xl text-lg"
                  onClick={() => onStart(line.taskId)}
                >
                  {tTasks("startWeighing")}
                </Button>
              )}

              {blocked && (
                <div className="flex flex-col items-center gap-4">
                  <p className="text-sm text-muted-foreground">{tTasks("pickAnother")}</p>
                  <div className="flex w-full max-w-xl gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => dispatch({ type: "SKIP", nowMs: Date.now() })}
                    >
                      {tNumpad("skip")}
                    </Button>
                    <Button
                      type="button"
                      className="flex-1"
                      disabled={!isLineReady(line, state.drafts)}
                      onClick={() => dispatch({ type: "NEXT", nowMs: Date.now() })}
                    >
                      {tNumpad("nextDefault")}
                    </Button>
                  </div>
                </div>
              )}

              {mineActive && <p className="text-xs text-muted-foreground">{tStation("autosaveHint")}</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <WarehouseEmptyState />
        </div>
      )}
    </div>
  );
}
