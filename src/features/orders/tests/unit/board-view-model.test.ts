import { describe, expect, it } from "vitest";
import { applyLens, classifyDropTarget, displayAmount, isAtRisk, matchesSearch, waLink } from "../../lib/board-view-model";
import type { OrderListItem } from "../../types";

const listItem = (over: Partial<OrderListItem>): OrderListItem =>
  ({ id: "x", status: "pending", delivery_date: "2026-08-24", total_amount: 0, ...over }) as OrderListItem;

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

describe("applyLens", () => {
  const today = "2026-08-24";
  const orders = [
    listItem({ id: "due-today", delivery_date: "2026-08-24" }),
    listItem({ id: "overdue-open", delivery_date: "2026-08-20", status: "confirmed" }),
    listItem({ id: "overdue-closed", delivery_date: "2026-08-20", status: "closed" }),
    listItem({ id: "tomorrow", delivery_date: "2026-08-25" }),
    listItem({ id: "next-week", delivery_date: "2026-08-31" }),
  ];

  it("all passes everything through", () => {
    expect(applyLens(orders, "all", today)).toHaveLength(5);
  });

  it("today = due today plus overdue orders still in flight", () => {
    expect(applyLens(orders, "today", today).map((o) => o.id)).toEqual([
      "due-today",
      "overdue-open",
    ]);
  });

  it("tomorrow = exactly tomorrow's date", () => {
    expect(applyLens(orders, "tomorrow", today).map((o) => o.id)).toEqual(["tomorrow"]);
  });
});

describe("isAtRisk", () => {
  const today = "2026-08-24";
  it("flags open orders due today or past", () => {
    expect(isAtRisk({ status: "pending", delivery_date: "2026-08-24" }, today)).toBe("dueToday");
    expect(isAtRisk({ status: "confirmed", delivery_date: "2026-08-20" }, today)).toBe("overdue");
  });
  it("never flags ready/delivered/closed/cancelled or future dates", () => {
    expect(isAtRisk({ status: "ready", delivery_date: "2026-08-20" }, today)).toBeNull();
    expect(isAtRisk({ status: "pending", delivery_date: "2026-08-25" }, today)).toBeNull();
  });
});

describe("matchesSearch", () => {
  const order = listItem({
    id: "1a1e6bcb-0000-0000-0000-000000000000",
    customer: { name: "Restoran Nasi Ayam Hj Salleh" },
    zone: { name: "Zone 1" },
  });

  it("matches customer name, zone, and id prefix, case-insensitively", () => {
    expect(matchesSearch(order, "salleh")).toBe(true);
    expect(matchesSearch(order, "zone 1")).toBe(true);
    expect(matchesSearch(order, "1a1e6b")).toBe(true);
  });

  it("empty query matches everything; misses miss", () => {
    expect(matchesSearch(order, "  ")).toBe(true);
    expect(matchesSearch(order, "mak timah")).toBe(false);
  });
});

describe("waLink", () => {
  it("converts Malaysian local numbers to wa.me with country code", () => {
    expect(waLink("012-345 6789")).toBe("https://wa.me/60123456789");
  });
  it("passes through numbers that already carry the country code", () => {
    expect(waLink("+60 12-345 6789")).toBe("https://wa.me/60123456789");
  });
});
