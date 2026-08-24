import { describe, expect, it } from "vitest";
import { bucketForRange, resolveRange, shiftDate, todayInTimeZone } from "../../analytics/date-range";

// 2026-08-24T17:30 UTC is already 2026-08-25 01:30 in Kuala Lumpur (+8).
const now = new Date("2026-08-24T17:30:00.000Z");

describe("todayInTimeZone", () => {
  it("uses the org timezone day, not UTC", () => {
    expect(todayInTimeZone("Asia/Kuala_Lumpur", now)).toBe("2026-08-25");
    expect(todayInTimeZone("UTC", now)).toBe("2026-08-24");
  });
});

describe("shiftDate", () => {
  it("shifts across month boundaries", () => {
    expect(shiftDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftDate("2026-08-25", -6)).toBe("2026-08-19");
  });
});

describe("resolveRange", () => {
  it("today is a single-day range", () => {
    expect(resolveRange("today", "Asia/Kuala_Lumpur", now)).toEqual({
      from: "2026-08-25",
      to: "2026-08-25",
    });
  });
  it("7d spans 7 calendar days ending today", () => {
    expect(resolveRange("7d", "Asia/Kuala_Lumpur", now)).toEqual({
      from: "2026-08-19",
      to: "2026-08-25",
    });
  });
  it("30d and 90d span the right lengths", () => {
    expect(resolveRange("30d", "Asia/Kuala_Lumpur", now).from).toBe("2026-07-27");
    expect(resolveRange("90d", "Asia/Kuala_Lumpur", now).from).toBe("2026-05-28");
  });
});

describe("bucketForRange", () => {
  it("uses day buckets up to 59 days and week buckets from 60", () => {
    expect(bucketForRange("2026-08-01", "2026-08-30")).toBe("day");
    expect(bucketForRange("2026-06-01", "2026-08-25")).toBe("week");
  });
});
