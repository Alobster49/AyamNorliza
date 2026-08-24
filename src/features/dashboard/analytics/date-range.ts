/**
 * Date-range helpers for the analytics dashboard. All ranges are inclusive
 * ISO dates (YYYY-MM-DD) in the organization's timezone; day boundaries are
 * never derived in the browser's locale.
 */

export type RangePreset = "today" | "7d" | "30d" | "90d";

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const PRESET_DAYS: Record<Exclude<RangePreset, "today">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function resolveRange(
  preset: RangePreset,
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = todayInTimeZone(timeZone, now);
  if (preset === "today") return { from: today, to: today };
  return { from: shiftDate(today, -(PRESET_DAYS[preset] - 1)), to: today };
}

export function rangeLengthDays(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function bucketForRange(from: string, to: string): "day" | "week" {
  return rangeLengthDays(from, to) >= 60 ? "week" : "day";
}
