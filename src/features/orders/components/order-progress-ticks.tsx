"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { WeighLine } from "../lib/weigh-model";

type OrderProgressTicksProps = {
  /** All lines of the current order, in queue order. */
  lines: WeighLine[];
  confirmed: Record<string, true>;
  currentItemId: string;
  className?: string;
};

/**
 * One tick per line of the current order: done lines green, the active line
 * primary, the rest muted. Hidden for single-line orders — a lone bar says
 * nothing.
 */
export function OrderProgressTicks({
  lines,
  confirmed,
  currentItemId,
  className,
}: OrderProgressTicksProps) {
  const t = useTranslations("orders.queue");
  if (lines.length < 2) return null;
  const customerName = lines[0]?.customerName ?? "";
  return (
    <div className={cn("flex gap-1", className)} aria-label={t("orderProgressAriaLabel", { customerName })}>
      {lines.map((l) => (
        <span
          key={l.itemId}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
            confirmed[l.itemId]
              ? "bg-emerald-500"
              : l.itemId === currentItemId
                ? "bg-primary"
                : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}
