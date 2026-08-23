"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatEstimate,
  formatRM,
} from "@/features/buyer/lib/price-estimate";

type ScaleChipProps = {
  estimate: { min: number; max: number } | null;
  perUnitLabel?: string;
  final?: { total: number; weightKg?: number | null; pricePerKg?: number | null };
  onInfo?: () => void;
  className?: string;
};

/**
 * The single price object of the buy flow. Estimate state: mono "~RM …" +
 * a hairline gauge spanning the min–max estimate. Final state: solid amount
 * with the weighed breakdown in --buyer-delta. Never renders disclaimer
 * prose — the "~" and the gauge ARE the explanation (taught once by the
 * pricing explainer sheet).
 */
export function ScaleChip({ estimate, perUnitLabel, final, onInfo, className }: ScaleChipProps) {
  if (final) {
    return (
      <div className={cn("space-y-0.5", className)}>
        <p className="font-buyer-mono text-base font-medium">{formatRM(final.total)}</p>
        {final.weightKg != null && final.pricePerKg != null && (
          <p className="font-buyer-mono text-xs" style={{ color: "var(--buyer-delta)" }}>
            Ditimbang {Number(final.weightKg)} kg × {formatRM(Number(final.pricePerKg))}/kg
          </p>
        )}
      </div>
    );
  }

  if (!estimate) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>Harga selepas timbang</p>
    );
  }

  // Gauge: pad the domain 15% either side so a flat range still shows a mark.
  const pad = Math.max((estimate.max - estimate.min) * 0.5, estimate.max * 0.15, 1);
  const lo = estimate.min - pad;
  const hi = estimate.max + pad;
  const left = ((estimate.min - lo) / (hi - lo)) * 100;
  const width = Math.max(((estimate.max - estimate.min) / (hi - lo)) * 100, 4);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-buyer-mono text-base font-medium">{formatEstimate(estimate)}</span>
        {perUnitLabel && (
          <span className="text-xs text-muted-foreground">{perUnitLabel}</span>
        )}
        {onInfo && (
          <button
            type="button"
            onClick={onInfo}
            aria-label="Kenapa harga anggaran?"
            className="text-muted-foreground transition-transform active:scale-95"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="relative h-0.5 w-24 overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className="absolute inset-y-0 rounded-full bg-primary"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
    </div>
  );
}
