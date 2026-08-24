import { describe, expect, it } from "vitest";
import { displayAmount } from "../../lib/board-view-model";

describe("displayAmount", () => {
  it("shows the total only for closed orders", () => {
    expect(displayAmount({ status: "closed", total_amount: 187.2 })).toEqual({
      kind: "total",
      amount: 187.2,
    });
  });

  it("marks every open status as unweighed (total is 0 until close_order)", () => {
    for (const status of ["pending", "confirmed", "ready", "delivered"] as const) {
      expect(displayAmount({ status, total_amount: 0 })).toEqual({ kind: "unweighed" });
    }
  });

  it("shows nothing for cancelled orders", () => {
    expect(displayAmount({ status: "cancelled", total_amount: 0 })).toEqual({ kind: "none" });
  });
});
