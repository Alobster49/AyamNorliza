"use client";

import { forwardRef } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isLineReady, type EntryTarget, type LineDraft, type WeighLine } from "../lib/weigh-model";
import { SizeBandGauge } from "./size-band-gauge";
import { WeighNumpad } from "./weigh-numpad";
import { WeightReadout } from "./weight-readout";

type SwipeCardProps = {
  line: WeighLine;
  draft: LineDraft;
  entryTarget: EntryTarget;
  interactive: boolean;
  onDispatchNumpad: (action: "digit" | "dot" | "backspace" | "toggle", digit?: string) => void;
  onSave: () => void;
  onSkip: () => void;
};

/**
 * One weighable line as a card in the mobile deck. The deck owns drag
 * transforms (via the forwarded ref); this component is purely presentational.
 */
export const SwipeCard = forwardRef<HTMLDivElement, SwipeCardProps>(function SwipeCard(
  { line, draft, entryTarget, interactive, onDispatchNumpad, onSave, onSkip },
  ref,
) {
  const t = useTranslations("orders.swipeCard");
  const tQueue = useTranslations("orders.queue");
  return (
    <div
      ref={ref}
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card p-5 shadow-lg will-change-transform",
        !interactive && "pointer-events-none",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {line.customerName} · {tQueue("itemProgress", { index: line.indexInTask, total: line.totalInTask })}
        </span>
        <Badge variant="secondary">{line.truckCode}</Badge>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 py-4">
        <div>
          <div className="text-xl font-semibold">{line.productName}</div>
          <div className="text-xs text-muted-foreground">
            {line.mode === "kg"
              ? t("orderedKg", { quantity: line.orderedQuantity, min: line.sizeMinKg, max: line.sizeMaxKg })
              : t("orderedPieces", { quantity: line.orderedQuantity, min: line.sizeMinKg, max: line.sizeMaxKg })}
          </div>
        </div>

        <div className="flex justify-center py-1">
          <WeightReadout
            weightKg={draft.weightKg}
            pieces={draft.pieces}
            entryTarget={entryTarget}
            size="card"
          />
        </div>

        <SizeBandGauge line={line} draft={draft} compact />

        <WeighNumpad
          variant="thumb"
          entryTarget={entryTarget}
          nextDisabled={!isLineReady(line, { [line.itemId]: draft })}
          nextLabel={t("saveNext")}
          onDigit={(digit) => onDispatchNumpad("digit", digit)}
          onDot={() => onDispatchNumpad("dot")}
          onBackspace={() => onDispatchNumpad("backspace")}
          onToggleTarget={() => onDispatchNumpad("toggle")}
          onNext={onSave}
          onSkip={onSkip}
        />
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        {t("swipeHint")}
      </p>
    </div>
  );
});
