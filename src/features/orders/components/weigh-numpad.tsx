"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Delete } from "lucide-react";
import type { EntryTarget } from "../lib/weigh-model";

type WeighNumpadProps = {
  variant: "kiosk" | "thumb";
  entryTarget: EntryTarget;
  nextDisabled: boolean;
  nextLabel?: string;
  onDigit: (digit: string) => void;
  onDot: () => void;
  onBackspace: () => void;
  onToggleTarget: () => void;
  onNext: () => void;
  onSkip: () => void;
};

/**
 * On-screen numpad shared by the kiosk (large keys, side action column) and
 * the mobile card (thumb grid). Buttons respond on pointer-down for
 * instant feedback; the browser click still commits the action.
 */
export function WeighNumpad({
  variant,
  entryTarget,
  nextDisabled,
  nextLabel,
  onDigit,
  onDot,
  onBackspace,
  onToggleTarget,
  onNext,
  onSkip,
}: WeighNumpadProps) {
  const t = useTranslations("orders.numpad");
  const resolvedNextLabel = nextLabel ?? t("nextDefault");
  const kiosk = variant === "kiosk";
  const keyBase = cn(
    "select-none rounded-xl border border-border bg-secondary font-mono transition-transform duration-100 motion-reduce:transition-none active:scale-95",
    "focus-visible:outline-2 focus-visible:outline-ring",
    kiosk ? "h-20 text-3xl" : "h-16 text-2xl",
  );
  const actionBase = cn(
    "select-none rounded-xl font-sans font-semibold transition-transform duration-100 motion-reduce:transition-none active:scale-95",
    "focus-visible:outline-2 focus-visible:outline-ring",
    kiosk ? "h-20 text-base" : "h-16 text-sm",
  );

  const digit = (d: string) => (
    <button key={d} type="button" className={keyBase} onClick={() => onDigit(d)}>
      {d}
    </button>
  );

  return (
    <div className={cn("grid grid-cols-4 gap-3", kiosk && "max-w-xl")}>
      {/* row 1 */}
      {["7", "8", "9"].map(digit)}
      <button
        type="button"
        className={cn(
          actionBase,
          entryTarget === "pieces"
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-secondary",
        )}
        onClick={onToggleTarget}
        aria-pressed={entryTarget === "pieces"}
      >
        {t("pieces")}
      </button>
      {/* row 2 */}
      {["4", "5", "6"].map(digit)}
      <button
        type="button"
        className={cn(keyBase, "flex items-center justify-center")}
        onClick={onBackspace}
        aria-label={t("backspace")}
      >
        <Delete className="size-5" aria-hidden />
      </button>
      {/* row 3 */}
      {["1", "2", "3"].map(digit)}
      <button
        type="button"
        className={cn(actionBase, "border border-border bg-secondary text-muted-foreground")}
        onClick={onSkip}
      >
        {t("skip")}
      </button>
      {/* row 4 */}
      {digit("0")}
      <button
        type="button"
        className={cn(keyBase, entryTarget === "pieces" && "opacity-30")}
        onClick={onDot}
        disabled={entryTarget === "pieces"}
      >
        .
      </button>
      <button
        type="button"
        className={cn(
          actionBase,
          "col-span-2 bg-primary text-primary-foreground disabled:opacity-40",
        )}
        onClick={onNext}
        disabled={nextDisabled}
      >
        {resolvedNextLabel}
      </button>
    </div>
  );
}
