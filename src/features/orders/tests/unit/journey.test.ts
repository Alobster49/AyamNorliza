import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS, journeyBanner, journeyCurrentStep } from "../../lib/journey";
import { ORDER_STATUSES } from "../../types";

describe("journeyCurrentStep", () => {
  it("maps each active status to its waiting step", () => {
    expect(journeyCurrentStep("pending")).toBe(1);
    expect(journeyCurrentStep("confirmed")).toBe(2);
    expect(journeyCurrentStep("ready")).toBe(3);
    expect(journeyCurrentStep("delivered")).toBe(4);
  });

  it("marks closed orders as past the last step", () => {
    expect(journeyCurrentStep("closed")).toBe(JOURNEY_STEPS.length);
  });

  it("gives cancelled orders no journey", () => {
    expect(journeyCurrentStep("cancelled")).toBeNull();
  });
});

describe("journeyBanner", () => {
  it("covers every status", () => {
    for (const status of ORDER_STATUSES) {
      const banner = journeyBanner(status, 2);
      if (status === "cancelled") {
        expect(banner).toBeNull();
      } else {
        expect(banner).not.toBeNull();
        expect(banner!.titleKey.length).toBeGreaterThan(0);
        expect(banner!.bodyKey.length).toBeGreaterThan(0);
      }
    }
  });

  it("asks for action on pending and delivered, not on waiting states", () => {
    expect(journeyBanner("pending", 3)!.tone).toBe("action");
    expect(journeyBanner("delivered", 3)!.tone).toBe("action");
    expect(journeyBanner("confirmed", 3)!.tone).toBe("waiting");
    expect(journeyBanner("ready", 3)!.tone).toBe("waiting");
    expect(journeyBanner("closed", 3)!.tone).toBe("done");
  });

  it("carries the pending item count as ICU plural values", () => {
    expect(journeyBanner("pending", 1)!.titleKey).toBe("pending.title");
    expect(journeyBanner("pending", 1)!.titleValues).toEqual({ count: 1 });
    expect(journeyBanner("pending", 4)!.titleValues).toEqual({ count: 4 });
  });
});
