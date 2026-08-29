/**
 * Small display-only date helpers shared by the My Leave page's history
 * table and who's-away list, so a date range always reads the same way
 * across the page: "24 Mar - 27 Mar, Tue - Fri". Pure formatting only — no
 * balance/workday math here, that stays in leave-model.ts.
 */

import { format, parseISO } from "date-fns";

/** "24 Mar - 27 Mar, Tue - Fri" (or the single-day form when start === end). */
export function formatDateRange(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  if (startDate === endDate) {
    return `${format(start, "d MMM")}, ${format(start, "EEE")}`;
  }
  const end = parseISO(endDate);
  return `${format(start, "d MMM")} - ${format(end, "d MMM")}, ${format(start, "EEE")} - ${format(end, "EEE")}`;
}

/** "25 Aug 2026" — used for holiday rows and the carry-forward expiry line. */
export function formatDisplayDate(date: string): string {
  return format(parseISO(date), "d MMM yyyy");
}
