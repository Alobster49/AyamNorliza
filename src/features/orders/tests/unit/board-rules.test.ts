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
    expect(resolveDrop("confirmed", "ready", "owner")).toEqual({
      kind: "blocked",
      reasonKey: "orders.board.blocked.ready",
      hintKey: "orders.board.hint.ready",
    });
  });

  it("blocks moves into delivered (except from closed) with the run reason", () => {
    expect(resolveDrop("ready", "delivered", "owner")).toEqual({
      kind: "blocked",
      reasonKey: "orders.board.blocked.delivered",
      hintKey: "orders.board.hint.delivered",
    });
  });

  it("blocks moves back to pending", () => {
    expect(resolveDrop("confirmed", "pending", "owner")).toEqual({
      kind: "blocked",
      reasonKey: "orders.board.blocked.pending",
      hintKey: "orders.board.hint.pending",
    });
  });

  it("blocks confirming a non-pending order", () => {
    expect(resolveDrop("ready", "confirmed", "owner")).toEqual({
      kind: "blocked",
      reasonKey: "orders.board.blocked.confirmed",
      hintKey: "orders.board.hint.confirmed",
    });
  });

  it("blocks cancelling ready/delivered/closed orders", () => {
    expect(resolveDrop("delivered", "cancelled", "owner")).toEqual({
      kind: "blocked",
      reasonKey: "orders.board.blocked.cancelled",
      hintKey: "orders.board.hint.cancelled",
    });
  });

  it("blocks closing a non-delivered order", () => {
    expect(resolveDrop("pending", "closed", "owner")).toEqual({
      kind: "blocked",
      reasonKey: "orders.board.blocked.closed",
      hintKey: "orders.board.hint.closed",
    });
  });

  it("blocks reopening a closed order for a non-admin role", () => {
    expect(resolveDrop("closed", "delivered", "sales")).toEqual({
      kind: "blocked",
      reasonKey: "orders.board.blocked.reopenRole",
      hintKey: "orders.board.hint.reopenRole",
    });
  });

  it("every from/to pair returns a resolution (total function)", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const result = resolveDrop(from, to, "owner");
        expect(result.kind).toBeDefined();
        if (result.kind === "blocked") expect(result.reasonKey.length).toBeGreaterThan(0);
      }
    }
  });
});
