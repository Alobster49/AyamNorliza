import { describe, expect, it } from "vitest";
import { resolveDispatchDrop, type DispatchDropTarget } from "../../lib/dispatch-rules";

const truckTarget = (over: Partial<Extract<DispatchDropTarget, { type: "truck" }>> = {}): DispatchDropTarget => ({
  type: "truck",
  truckId: "t-1",
  compatible: true,
  atCapacity: false,
  departed: false,
  ...over,
});

describe("resolveDispatchDrop", () => {
  it("assigns a confirmed ticket to a compatible truck", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "assign", truckId: "t-1" });
  });

  it("no-ops when dropped on the truck it is already on", () => {
    const result = resolveDispatchDrop(
      { status: "ready", assignedTruckId: "t-1", runStatus: "planned" },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "noop" });
  });

  it("requires override confirmation for an incompatible truck", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      truckTarget({ compatible: false }),
    );
    expect(result).toEqual({ kind: "override", truckId: "t-1" });
  });

  it("blocks a drop onto a full truck", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      truckTarget({ atCapacity: true }),
    );
    expect(result).toEqual({ kind: "blocked", reason: "That truck is at its slot capacity for this date." });
  });

  it("blocks a drop onto a departed truck", () => {
    const result = resolveDispatchDrop(
      { status: "ready", assignedTruckId: null, runStatus: null },
      truckTarget({ departed: true }),
    );
    expect(result).toEqual({ kind: "blocked", reason: "That truck has already departed." });
  });

  it("blocks moving a ticket whose run has departed", () => {
    const result = resolveDispatchDrop(
      { status: "ready", assignedTruckId: "t-2", runStatus: "departed" },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "blocked", reason: "This order is on a departed run and can no longer be moved." });
  });

  it("blocks tickets that are not confirmed or ready", () => {
    const result = resolveDispatchDrop(
      { status: "pending", assignedTruckId: null, runStatus: null },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "blocked", reason: "Only confirmed or ready orders can be dispatched." });
  });

  it("unassigns when an assigned ticket is dropped on the pool", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: "t-1", runStatus: "planned" },
      { type: "pool" },
    );
    expect(result).toEqual({ kind: "unassign" });
  });

  it("no-ops when an unassigned ticket is dropped on the pool", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      { type: "pool" },
    );
    expect(result).toEqual({ kind: "noop" });
  });
});
