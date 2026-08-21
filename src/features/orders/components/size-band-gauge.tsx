import { cn } from "@/lib/utils";
import {
  averageBirdKg,
  bandStatus,
  sizeBandTrackPosition,
  type LineDraft,
  type WeighLine,
} from "../lib/weigh-model";

type SizeBandGaugeProps = {
  line: WeighLine;
  draft: LineDraft;
  compact?: boolean;
};

/**
 * Visualizes whether the average bird weight sits inside the ordered size
 * band. For kg-mode lines with no pieces entered, falls back to showing the
 * delta between entered total and ordered kg.
 */
export function SizeBandGauge({ line, draft, compact = false }: SizeBandGaugeProps) {
  const status = bandStatus(line, draft);
  const avg = averageBirdKg(line, draft);

  if (status === "delta_only") {
    const delta = Number(draft.weightKg) - line.orderedQuantity;
    const sign = delta >= 0 ? "+" : "";
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">vs {line.orderedQuantity} kg ordered</span>
        <span
          className={cn(
            "font-mono tabular-nums",
            Math.abs(delta) / line.orderedQuantity > 0.1 ? "text-amber-500" : "text-emerald-500",
          )}
        >
          {sign}
          {delta.toFixed(3)} kg
        </span>
      </div>
    );
  }

  const marker = avg !== null ? sizeBandTrackPosition(avg, line.sizeMinKg, line.sizeMaxKg) : null;
  // Band occupies the middle of a domain extended by half a band-width each side.
  const bandLeft = sizeBandTrackPosition(line.sizeMinKg, line.sizeMinKg, line.sizeMaxKg);
  const bandRight = sizeBandTrackPosition(line.sizeMaxKg, line.sizeMinKg, line.sizeMaxKg);

  return (
    <div className={cn("flex flex-col", compact ? "gap-1" : "gap-1.5")}>
      <div className={cn("relative rounded-full bg-muted", compact ? "h-1.5" : "h-2")}>
        <div
          className="absolute inset-y-0 rounded-full bg-emerald-500/25"
          style={{ left: `${bandLeft * 100}%`, width: `${(bandRight - bandLeft) * 100}%` }}
        />
        {marker !== null && (
          <div
            className={cn(
              "absolute -inset-y-0.5 w-1 -translate-x-1/2 rounded-full transition-[left] duration-150 motion-reduce:transition-none",
              status === "in_band" ? "bg-emerald-500" : "bg-amber-500",
            )}
            style={{ left: `${marker * 100}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {line.sizeMinKg}–{line.sizeMaxKg} kg / bird
        </span>
        {status === "empty" ? (
          <span>waiting for weight</span>
        ) : (
          <span
            className={cn(
              "font-medium",
              status === "in_band" ? "text-emerald-500" : "text-amber-500",
            )}
          >
            {avg !== null && `avg ${avg.toFixed(2)} kg · `}
            {status === "in_band" ? "in band" : "out of band"}
          </span>
        )}
      </div>
    </div>
  );
}
