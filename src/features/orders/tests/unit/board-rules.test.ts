import { describe, expect, it } from "vitest";
import { resolveDrop } from "../../lib/board-rules";
import { ORDER_STATUSES } from "../../types";

describe("resolveDrop", () => {
  it("is a noop when dropped on the same column", () => {
    for (const status of ORDER_STATUSES) {
      expect(resolveDrop(status, status, "owner")).toEqual({ kind: "noop" });
    }
  });

  it("pending → confirmed opens the confirm workflow", () => {
    expect(resolveDrop("pending", "confirmed", "sales")).toEqual({ kind: "confirm" });
  });

  it("pending and confirmed → cancelled open the cancel workflow", () => {
    expect(resolveDrop("pending", "cancelled", "sales")).toEqual({ kind: "cancel" });
    expect(resolveDrop("confirmed", "cancelled", "sales")).toEqual({ kind: "cancel" });
  });

  it("delivered → closed routes to settlement", () => {
    expect(resolveDrop("delivered", "closed", "sales")).toEqual({ kind: "settle" });
  });

  it("closed → delivered reopens for owner and org_admin only", () => {
    expect(resolveDrop("closed", "delivered", "owner")).toEqual({ kind: "reopen" });
    expect(resolveDrop("closed", "delivered", "org_admin")).toEqual({ kind: "reopen" });
    const blocked = resolveDrop("closed", "delivered", "sales");
    expect(blocked.kind).toBe("blocked");
  });

  it("blocks moves into ready with the weigh-task reason", () => {
    const result = resolveDrop("confirmed", "ready", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Ready is set by the warehouse weigh task.",
    });
  });

  it("blocks moves into delivered (except from closed) with the run reason", () => {
    const result = resolveDrop("ready", "delivered", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Delivered is set when the delivery run completes.",
    });
  });

  it("blocks moves back to pending", () => {
    const result = resolveDrop("confirmed", "pending", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Orders cannot move back to pending.",
    });
  });

  it("blocks confirming a non-pending order", () => {
    const result = resolveDrop("ready", "confirmed", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Only pending orders can be confirmed.",
    });
  });

  it("blocks cancelling ready/delivered/closed orders", () => {
    const result = resolveDrop("delivered", "cancelled", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Only pending or confirmed orders can be cancelled.",
    });
  });

  it("blocks closing a non-delivered order", () => {
    const result = resolveDrop("pending", "closed", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Only delivered orders can be closed.",
    });
  });

  it("every from/to pair returns a resolution (total function)", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const result = resolveDrop(from, to, "owner");
        expect(result.kind).toBeDefined();
        if (result.kind === "blocked") expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });
});
