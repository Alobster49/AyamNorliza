"use client";

import type { WatchRow } from "../lib/market-model";
import { marketStateAbbr } from "../types";
import { DeltaBadge } from "./delta-badge";

/**
 * One strip, every state. Scrolls sideways on narrow screens instead of
 * wrapping, with the right edge faded so it reads as a tape.
 */
export function TickerTape({ rows }: { rows: WatchRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10">
      <div
        className="flex h-10 items-center overflow-x-auto font-mono text-xs tabular-nums [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="ticker"
      >
        {rows.map((row) => (
          <span
            key={row.state}
            className="flex shrink-0 items-center gap-1.5 border-r border-border px-4 whitespace-nowrap"
            title={row.state}
          >
            <span className="text-muted-foreground">{marketStateAbbr(row.state)}</span>
            <span className="font-medium">{row.last.toFixed(2)}</span>
            <DeltaBadge delta={row.d1} />
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-r from-transparent to-card" />
    </div>
  );
}
