import { describe, expect, it } from "vitest";
import { shiftIsoDate, todayInTimeZone, tomorrowInTimeZone } from "./org-date";

// 2026-08-22T18:25:42Z is 2026-08-23 02:25 in Kuala Lumpur: the window where
// the UTC date and the depot's date disagree, and the window the warehouse
// early shift actually works in.
const EARLY_MORNING_MYT = new Date("2026-08-22T18:25:42Z");

describe("todayInTimeZone", () => {
  it("returns the depot's calendar date, not the server's", () => {
    expect(todayInTimeZone("Asia/Kuala_Lumpur", EARLY_MORNING_MYT)).toBe("2026-08-23");
    expect(todayInTimeZone("UTC", EARLY_MORNING_MYT)).toBe("2026-08-22");
  });

  it("agrees with UTC once both sides are on the same day", () => {
    const midday = new Date("2026-08-23T04:00:00Z"); // 12:00 MYT
    expect(todayInTimeZone("Asia/Kuala_Lumpur", midday)).toBe("2026-08-23");
    expect(todayInTimeZone("UTC", midday)).toBe("2026-08-23");
  });

  it("handles a zone behind UTC", () => {
    // 2026-08-23T02:00Z is still 2026-08-22 in New York.
    expect(todayInTimeZone("America/New_York", new Date("2026-08-23T02:00:00Z"))).toBe("2026-08-22");
  });

  it("zero-pads single-digit months and days", () => {
    expect(todayInTimeZone("Asia/Kuala_Lumpur", new Date("2026-01-04T02:00:00Z"))).toBe("2026-01-04");
  });

  it("falls back to UTC rather than throwing on a junk time zone", () => {
    expect(todayInTimeZone("Not/AZone", EARLY_MORNING_MYT)).toBe("2026-08-22");
  });
});

describe("tomorrowInTimeZone", () => {
  it("is the day after the depot's today, not the server's", () => {
    expect(tomorrowInTimeZone("Asia/Kuala_Lumpur", EARLY_MORNING_MYT)).toBe("2026-08-24");
    expect(tomorrowInTimeZone("UTC", EARLY_MORNING_MYT)).toBe("2026-08-23");
  });

  it("rolls over a month boundary", () => {
    expect(tomorrowInTimeZone("Asia/Kuala_Lumpur", new Date("2026-08-31T04:00:00Z"))).toBe("2026-09-01");
  });

  it("rolls over a year boundary", () => {
    expect(tomorrowInTimeZone("Asia/Kuala_Lumpur", new Date("2026-12-31T04:00:00Z"))).toBe("2027-01-01");
  });
});

describe("shiftIsoDate", () => {
  it("moves forwards and backwards without a timezone shifting the day", () => {
    expect(shiftIsoDate("2026-08-23", 1)).toBe("2026-08-24");
    expect(shiftIsoDate("2026-08-23", -1)).toBe("2026-08-22");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});
