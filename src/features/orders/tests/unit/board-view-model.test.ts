import { describe, expect, it } from "vitest";
import { classifyDropTarget, displayAmount } from "../../lib/board-view-model";

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

describe("classifyDropTarget", () => {
  it("is idle on the origin column", () => {
    expect(classifyDropTarget("pending", "pending", "owner")).toEqual({ mode: "idle" });
  });

  it("invites legal workflow targets", () => {
    expect(classifyDropTarget("pending", "confirmed", "seller")).toEqual({ mode: "invite" });
    expect(classifyDropTarget("delivered", "closed", "seller")).toEqual({ mode: "invite" });
    expect(classifyDropTarget("closed", "delivered", "owner")).toEqual({ mode: "invite" });
  });

  it("declines blocked targets with the short hint", () => {
    expect(classifyDropTarget("pending", "ready", "seller")).toEqual({
      mode: "decline",
      hintKey: "orders.board.hint.ready",
    });
    expect(classifyDropTarget("closed", "delivered", "seller")).toEqual({
      mode: "decline",
      hintKey: "orders.board.hint.reopenRole",
    });
  });
});
