"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  isLineReady,
  type LineDraft,
  type WeighAction,
  type WeighState,
} from "../lib/weigh-model";
import { QueueRail } from "./queue-rail";
import { WarehouseEmptyState } from "./warehouse-empty-state";
import { SizeBandGauge } from "./size-band-gauge";
import { WeighNumpad } from "./weigh-numpad";
import { WeightReadout } from "./weight-readout";

const EMPTY_DRAFT: LineDraft = { weightKg: "", pieces: "" };

type WeighStationProps = {
  state: WeighState;
  dispatch: (action: WeighAction) => void;
  syncingTaskIds: ReadonlySet<string>;
  className?: string;
};

/**
 * Desktop/tablet kiosk: queue rail on the left, one line at a time on the
 * right with a scale-sized readout, size-band gauge and numpad.
 */
export function WeighStation({ state, dispatch, syncingTaskIds, className }: WeighStationProps) {
  const tDetail = useTranslations("orders.detail");
  const tQueue = useTranslations("orders.queue");
  const tStation = useTranslations("orders.station");
  const tSwipeCard = useTranslations("orders.swipeCard");
  const line = state.queue[state.cursor];

  return (
    <div className={cn("min-h-0 flex-1 overflow-hidden rounded-lg border", className)}>
      {line ? (
        <div className="flex h-full">
          <QueueRail
            queue={state.queue}
            confirmed={state.confirmed}
            cursor={state.cursor}
            syncingTaskIds={syncingTaskIds}
            onSelect={(index) => dispatch({ type: "GO_TO", index })}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto p-8 [scrollbar-gutter:stable_both-edges]">
            <div className="flex w-full max-w-xl flex-col gap-8">
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

              <WeighNumpad
                variant="kiosk"
                entryTarget={state.entryTarget}
                nextDisabled={!isLineReady(line, state.drafts)}
                onDigit={(digit) => dispatch({ type: "DIGIT", digit })}
                onDot={() => dispatch({ type: "DOT" })}
                onBackspace={() => dispatch({ type: "BACKSPACE" })}
                onToggleTarget={() => dispatch({ type: "TOGGLE_TARGET" })}
                onNext={() => dispatch({ type: "NEXT" })}
                onSkip={() => dispatch({ type: "SKIP" })}
              />

              <p className="text-xs text-muted-foreground">{tStation("autosaveHint")}</p>
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
