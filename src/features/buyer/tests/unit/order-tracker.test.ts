import { describe, expect, it } from "vitest";
import { TRACKER_STEPS, trackerIndex } from "@/features/buyer/lib/order-tracker";

describe("trackerIndex", () => {
  it.each([
    ["pending", 0], ["confirmed", 0], ["ready", 0],
    ["delivered", 1],
    ["closed", 2],
  ] as const)("%s → %i", (status, expected) => {
    expect(trackerIndex(status)).toBe(expected);
  });
  it("cancelled → null", () => {
    expect(trackerIndex("cancelled")).toBeNull();
  });
  it("has exactly three steps", () => {
    expect(TRACKER_STEPS).toHaveLength(3);
  });
});
