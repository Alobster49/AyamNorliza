import { cn } from "@/lib/utils";
import type { Delta } from "../lib/market-model";

type Props = {
  delta: Delta | null;
  /** Show the RM change instead of the percentage. */
  absolute?: boolean;
  className?: string;
};

function Triangle({ up }: { up: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className="shrink-0">
      <path d={up ? "M4 1 7 7H1z" : "M4 7 1 1h6z"} fill="currentColor" />
    </svg>
  );
}

/** Signed change with a direction glyph, so colour never carries it alone. */
export function DeltaBadge({ delta, absolute = false, className }: Props) {
  if (!delta) {
    return <span className={cn("text-muted-foreground tabular-nums", className)}>—</span>;
  }
  const dir = Math.sign(delta.pct);
  const value = absolute ? Math.abs(delta.abs).toFixed(2) : `${Math.abs(delta.pct).toFixed(1)}%`;
  const sign = dir > 0 ? "+" : dir < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap tabular-nums",
        dir > 0 && "text-emerald-600 dark:text-emerald-400",
        dir < 0 && "text-red-600 dark:text-red-400",
        dir === 0 && "text-muted-foreground",
        className,
      )}
    >
      {dir !== 0 && <Triangle up={dir > 0} />}
      <span>
        {sign}
        {value}
      </span>
    </span>
  );
}
