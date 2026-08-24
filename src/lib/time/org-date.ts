/**
 * "Today" for an organization, in the organization's own time zone.
 *
 * The depot runs on Malaysian time; the server does not. `toISOString()` is
 * UTC and `new Date().getFullYear()` is whatever the host is set to, so both
 * disagree with the depot for the eight hours between 00:00 and 08:00 MYT --
 * exactly the window the warehouse early shift works in. Getting this wrong
 * hides tomorrow's orders from the weigh queue and opens the loading and
 * dispatch boards on the wrong day.
 *
 * The org already carries the answer in `organizations.default_time_zone`, so
 * every date the server computes for a user should come through here.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // A junk value in default_time_zone should not take a page down. UTC is
    // the column's own default, so fall back to it.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  formatters.set(timeZone, formatter);
  return formatter;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = timeFormatters.get(timeZone);
  if (cached) return cached;

  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
  }

  timeFormatters.set(timeZone, formatter);
  return formatter;
}

/**
 * Wall-clock minutes since midnight in `timeZone` right now. Pairs with
 * `todayInTimeZone` for "now" markers on day views: comparing the depot's
 * date with the browser's clock mixes two zones and drifts by the offset.
 */
export function minutesOfDayInTimeZone(timeZone: string, now: Date = new Date()): number {
  const parts = timeFormatterFor(timeZone).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return pick("hour") * 60 + pick("minute");
}

/** The calendar date in `timeZone` right now, as yyyy-mm-dd. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  // formatToParts rather than format(): the assembled parts are locale-proof,
  // where a formatted string's separators and field order are not.
  const parts = formatterFor(timeZone).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** The day after `todayInTimeZone`, as yyyy-mm-dd. */
export function tomorrowInTimeZone(timeZone: string, now: Date = new Date()): string {
  return shiftIsoDate(todayInTimeZone(timeZone, now), 1);
}

/**
 * Date arithmetic on a yyyy-mm-dd, done in UTC so the shift can never land on
 * a different day than asked for. Takes an already-resolved calendar date, so
 * it is time-zone agnostic by construction.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
