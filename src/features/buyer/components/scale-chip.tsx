"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatPrice, formatWeight } from "@/features/orders/lib/order-model";

type ScaleChipProps = {
  final?: { total: number; weightKg?: number | null; pricePerKg?: number | null } | null;
  onInfo?: () => void;
  className?: string;
};

/**
 * The single price object of the buy flow. Before confirm there is no price
 * to show at all -- just the weight-framing message ("price after
 * weighing"). Final state (post-confirm/close): solid amount with the
 * weighed breakdown in --buyer-delta.
 */
export function ScaleChip({ final, onInfo, className }: ScaleChipProps) {
  const t = useTranslations("buyer.pricing");
  if (final) {
    return (
      <div className={cn("space-y-0.5", className)}>
        <p className="font-buyer-mono text-base font-medium">{formatPrice(final.total)}</p>
        {final.weightKg != null && final.pricePerKg != null && (
          <p className="font-buyer-mono text-xs" style={{ color: "var(--buyer-delta)" }}>
            {t("weighed", {
              weight: formatWeight(Number(final.weightKg)),
              pricePerKg: formatPrice(Number(final.pricePerKg)),
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <p className="text-sm text-muted-foreground">{t("afterWeighing")}</p>
      {onInfo && (
        <button
          type="button"
          onClick={onInfo}
          aria-label={t("whyEstimate")}
          className="text-muted-foreground transition-transform active:scale-95"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
