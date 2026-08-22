"use client";

import { CheckCircle2, ClipboardList, Clock } from "lucide-react";
import type { OrderStatus } from "../types";
import {
  JOURNEY_STEPS,
  journeyBanner,
  journeyCurrentStep,
  type JourneyBannerTone,
} from "../lib/journey";

/**
 * Five-segment lifecycle bar: done segments green, the current one amber.
 * Labels show from `sm:` up; phones get a compact "Step N of 5" line.
 */
export function JourneyBar({ status }: { status: OrderStatus }) {
  const current = journeyCurrentStep(status);
  if (current == null) return null;

  const segmentClass = (i: number) =>
    i < current ? "bg-emerald-500" : i === current ? "bg-amber-500" : "bg-muted";
  const labelClass = (i: number) =>
    i < current
      ? "text-emerald-600 dark:text-emerald-400"
      : i === current
        ? "font-medium text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div aria-label={`Order progress: step ${Math.min(current + 1, JOURNEY_STEPS.length)} of ${JOURNEY_STEPS.length}`}>
      <div className="flex gap-1.5">
        {JOURNEY_STEPS.map((label, i) => (
          <div key={label} className={`h-1.5 flex-1 rounded-full ${segmentClass(i)}`} />
        ))}
      </div>
      <div className="mt-1.5 hidden gap-1.5 sm:flex">
        {JOURNEY_STEPS.map((label, i) => (
          <div key={label} className={`flex-1 text-[11px] ${labelClass(i)}`}>
            {label}
          </div>
        ))}
      </div>
      {current < JOURNEY_STEPS.length && (
        <p className="mt-1.5 text-xs text-muted-foreground sm:hidden">
          Step {current + 1} of {JOURNEY_STEPS.length} —{" "}
          <span className="font-medium text-amber-600 dark:text-amber-400">
            {JOURNEY_STEPS[current]}
          </span>
        </p>
      )}
    </div>
  );
}

const TONE_STYLES: Record<JourneyBannerTone, { wrap: string; title: string }> = {
  action: {
    wrap: "border-amber-500/40 bg-amber-500/10",
    title: "text-amber-700 dark:text-amber-400",
  },
  waiting: {
    wrap: "border-border bg-card",
    title: "text-foreground",
  },
  done: {
    wrap: "border-emerald-500/40 bg-emerald-500/10",
    title: "text-emerald-700 dark:text-emerald-400",
  },
};

const TONE_ICONS: Record<JourneyBannerTone, typeof ClipboardList> = {
  action: ClipboardList,
  waiting: Clock,
  done: CheckCircle2,
};

/** One-sentence "what does this screen want from me" card under the bar. */
export function NextActionBanner({ status, itemCount }: { status: OrderStatus; itemCount: number }) {
  const banner = journeyBanner(status, itemCount);
  if (!banner) return null;

  const tone = TONE_STYLES[banner.tone];
  const Icon = TONE_ICONS[banner.tone];

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${tone.wrap}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.title}`} aria-hidden />
      <div>
        <p className={`text-sm font-semibold ${tone.title}`}>{banner.title}</p>
        <p className="text-sm text-muted-foreground">{banner.body}</p>
      </div>
    </div>
  );
}
