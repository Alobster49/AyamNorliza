import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { EntryTarget } from "../lib/weigh-model";

type WeightReadoutProps = {
  weightKg: string;
  pieces: string;
  entryTarget: EntryTarget;
  size: "kiosk" | "card";
};

/**
 * Large scale-style readout for the value being entered. The active target
 * (weight or pieces) is emphasized; the other shown small beside it.
 */
export function WeightReadout({ weightKg, pieces, entryTarget, size }: WeightReadoutProps) {
  const t = useTranslations("orders.weightReadout");
  const weightActive = entryTarget === "weight";
  const primary = weightActive ? weightKg : pieces;
  const secondary = weightActive ? pieces : weightKg;

  const unitLabel = (value: string, isPieces: boolean) =>
    isPieces ? t("unitPieces", { count: Number(value) || 0 }) : t("unitKg");

  const primaryUnit = unitLabel(primary, !weightActive);
  const secondaryUnit = unitLabel(secondary, weightActive);

  return (
    <div className={cn("flex flex-wrap items-baseline", size === "kiosk" ? "gap-3" : "gap-2")}>
      <span
        className={cn(
          "font-mono tabular-nums leading-none tracking-tight",
          size === "kiosk" ? "text-8xl" : "text-6xl",
          primary === "" && "text-muted-foreground/40",
        )}
        aria-live="polite"
      >
        {primary === "" ? "0" : primary}
      </span>
      <span className={cn("text-muted-foreground", size === "kiosk" ? "text-xl" : "text-base")}>
        {primaryUnit}
      </span>
      {secondary !== "" && (
        <span
          className={cn(
            "font-mono tabular-nums text-muted-foreground",
            size === "kiosk" ? "text-xl" : "text-sm",
          )}
        >
          · {secondary} {secondaryUnit}
        </span>
      )}
    </div>
  );
}
