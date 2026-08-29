import { describe, expect, it } from "vitest";
import { CLAIM_TTL_MS } from "@/lib/claims";
import type { TaskWithOrder } from "../../types";
import {
  applyBackspace,
  applyDigit,
  applyDot,
  bandStatus,
  buildCompletePayload,
  buildLineQueue,
  canUndo,
  createWeighState,
  firstReadyUnsubmittedTaskId,
  groupQueueByTask,
  indexOfOrder,
  isLineReady,
  isPiecesValid,
  isTaskBlocked,
  isTaskComplete,
  isWeightValid,
  nextIncompleteIndex,
  queueWithPendingRemovals,
  sizeBandTrackPosition,
  weighReducer,
  type WeighState,
} from "../../lib/weigh-model";

const NOW = Date.parse("2026-08-29T08:00:00.000Z");
const ACTIVE_AT = new Date(NOW - 60_000).toISOString();
const EXPIRED_AT = new Date(NOW - CLAIM_TTL_MS - 1).toISOString();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let uuidCounter = 0;
function uuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(),
    order_id: "order-1",
    product_id: "prod-1",
    mode: "kg",
    quantity: 40,
    size_min_kg: 1.2,
    size_max_kg: 1.5,
    fallback: "cancel",
    fallback_applied: null,
    is_cancelled: false,
    warehouse_weight_kg: null,
    warehouse_pieces: null,
    final_weight_kg: null,
    final_pieces: null,
    price_per_kg: 10,
    line_total: null,
    created_at: "",
    updated_at: "",
    version: 1,
    product: { id: "prod-1", name: "Ayam Standard", image_url: null },
    ...overrides,
  };
}

function makeTask(items: ReturnType<typeof makeItem>[], overrides: Record<string, unknown> = {}) {
  const orderId = uuid();
  return {
    id: uuid(),
    organization_id: "org-1",
    order_id: orderId,
    type: "allocate_weigh",
    assigned_to: null,
    status: "pending",
    done_by: null,
    done_at: null,
    weigh_claimed_by: null,
    weigh_claimed_at: null,
    created_at: "",
    updated_at: "",
    version: 1,
    order: {
      id: orderId,
      organization_id: "org-1",
      customer_id: "cust-1",
      created_by: null,
      source: "portal",
      status: "confirmed",
      zone_id: "zone-1",
      delivery_address: "addr",
      delivery_date: "2026-08-19",
      slot_id: "slot-1",
      truck_id: "truck-1",
      run_id: null,
      postcode: null,
      assignment_source: "auto",
      notes: null,
      total_amount: 0,
      closed_at: null,
      created_at: "",
      updated_at: "",
      version: 1,
      items,
      truck: {
        id: "truck-1",
        organization_id: "org-1",
        name: "Truck 1",
        code: "TRK-01",
        is_active: true,
        bay_id: null,
        created_by: null,
        created_at: "",
        updated_at: "",
        version: 1,
      },
      slot: {
        id: "slot-1",
        organization_id: "org-1",
        truck_id: "truck-1",
        weekday: 2,
        start_time: "06:30",
        end_time: "09:00",
        max_orders: null,
        is_active: true,
        created_by: null,
        created_at: "",
        updated_at: "",
        version: 1,
      },
      customer: { id: "cust-1", name: "Restoran Deen Maju", phone: "0123" },
    },
    ...overrides,
  } as unknown as TaskWithOrder;
}

/** A single-line task, for claim/sync scenarios where per-task granularity matters. */
function makeClaimTask(overrides: Record<string, unknown> = {}): TaskWithOrder {
  return makeTask([makeItem({ mode: "kg", quantity: 10 })], overrides);
}

/** Two tasks: task A has 2 lines (kg + piece mode), task B has 1 line. */
function fixtureTasks(): TaskWithOrder[] {
  const a1 = makeItem({ mode: "kg", quantity: 40 });
  const a2 = makeItem({ mode: "piece", quantity: 12, size_min_kg: 1.8, size_max_kg: 2.2 });
  const cancelled = makeItem({ is_cancelled: true });
  const b1 = makeItem({ mode: "kg", quantity: 25 });
  return [makeTask([a1, a2, cancelled]), makeTask([b1])];
}

function stateWith(tasks = fixtureTasks()): WeighState {
  return createWeighState(tasks);
}

function fillLine(state: WeighState, index: number, weight: string, pieces = ""): WeighState {
  const line = state.queue[index];
  return {
    ...state,
    drafts: { ...state.drafts, [line!.itemId]: { weightKg: weight, pieces } },
  };
}

/** Fill and confirm a line, as Next/Save would. */
function confirmLine(state: WeighState, index: number, weight: string, pieces = ""): WeighState {
  const filled = fillLine(state, index, weight, pieces);
  return {
    ...filled,
    confirmed: { ...filled.confirmed, [state.queue[index]!.itemId]: true },
  };
}

// ---------------------------------------------------------------------------
// buildLineQueue
// ---------------------------------------------------------------------------

describe("focusing one order", () => {
  it("carries the full order id on every line", () => {
    const tasks = fixtureTasks();
    const queue = buildLineQueue(tasks);
    expect(queue[0]!.orderId).toBe(tasks[0]!.order.id);
    expect(queue[2]!.orderId).toBe(tasks[1]!.order.id);
    expect(queue[0]!.orderIdShort).toBe(tasks[0]!.order.id.slice(0, 8));
  });

  it("finds the first line of an order", () => {
    const tasks = fixtureTasks();
    const queue = buildLineQueue(tasks);
    expect(indexOfOrder(queue, tasks[1]!.order.id)).toBe(2);
    expect(indexOfOrder(queue, "no-such-order")).toBe(-1);
  });

  it("opens on the focused order instead of the top of the queue", () => {
    const tasks = fixtureTasks();
    expect(createWeighState(tasks, { focusOrderId: tasks[1]!.order.id }).cursor).toBe(2);
  });

  it("falls back to the top when the order is not in the queue", () => {
    const tasks = fixtureTasks();
    expect(createWeighState(tasks, { focusOrderId: "no-such-order" }).cursor).toBe(0);
    expect(createWeighState(tasks).cursor).toBe(0);
  });
});

describe("buildLineQueue", () => {
  it("flattens tasks into lines, excluding cancelled items", () => {
    const queue = buildLineQueue(fixtureTasks());
    expect(queue).toHaveLength(3);
    expect(queue.map((l) => l.productName)).toEqual([
      "Ayam Standard",
      "Ayam Standard",
      "Ayam Standard",
    ]);
  });

  it("numbers lines within their task", () => {
    const queue = buildLineQueue(fixtureTasks());
    expect(queue[0]!.indexInTask).toBe(1);
    expect(queue[0]!.totalInTask).toBe(2);
    expect(queue[1]!.indexInTask).toBe(2);
    expect(queue[2]!.indexInTask).toBe(1);
    expect(queue[2]!.totalInTask).toBe(1);
  });

  it("carries customer, truck code, slot window and short order id", () => {
    const queue = buildLineQueue(fixtureTasks());
    expect(queue[0]!.customerName).toBe("Restoran Deen Maju");
    expect(queue[0]!.truckCode).toBe("TRK-01");
    expect(queue[0]!.slotWindow).toEqual({ start: "06:30", end: "09:00" });
    expect(queue[0]!.orderIdShort).toHaveLength(8);
  });

  it("returns empty queue for no tasks", () => {
    expect(buildLineQueue([])).toEqual([]);
  });

  it("groups queue by task preserving order", () => {
    const queue = buildLineQueue(fixtureTasks());
    const groups = groupQueueByTask(queue);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.lines).toHaveLength(2);
    expect(groups[1]!.lines).toHaveLength(1);
    expect(groups[0]!.taskId).toBe(queue[0]!.taskId);
  });
});

// ---------------------------------------------------------------------------
// Numpad buffer edits
// ---------------------------------------------------------------------------

describe("numpad buffer", () => {
  it("appends digits", () => {
    expect(applyDigit("", "4", "weight")).toBe("4");
    expect(applyDigit("4", "2", "weight")).toBe("42");
  });

  it("replaces a lone leading zero", () => {
    expect(applyDigit("0", "5", "weight")).toBe("5");
    expect(applyDigit("0", "0", "weight")).toBe("0");
  });

  it("allows 0. prefix", () => {
    expect(applyDot("0")).toBe("0.");
    expect(applyDigit("0.", "5", "weight")).toBe("0.5");
  });

  it("caps weight at 3 decimals", () => {
    expect(applyDigit("1.234", "5", "weight")).toBe("1.234");
  });

  it("dot on empty buffer produces 0.", () => {
    expect(applyDot("")).toBe("0.");
  });

  it("ignores a second dot", () => {
    expect(applyDot("1.2")).toBe("1.2");
  });

  it("backspace removes last char, empty stays empty", () => {
    expect(applyBackspace("1.2")).toBe("1.");
    expect(applyBackspace("")).toBe("");
  });

  it("pieces target rejects dot and caps at 4 digits", () => {
    expect(applyDigit("12", "3", "pieces")).toBe("123");
    expect(applyDigit("1234", "5", "pieces")).toBe("1234");
  });

  it("caps weight integer part at 4 digits", () => {
    expect(applyDigit("1000", "5", "weight")).toBe("1000");
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validation", () => {
  it("weight must be finite, > 0, <= 1000", () => {
    expect(isWeightValid("41.62")).toBe(true);
    expect(isWeightValid("1000")).toBe(true);
    expect(isWeightValid("0")).toBe(false);
    expect(isWeightValid("-1")).toBe(false);
    expect(isWeightValid("1000.001")).toBe(false);
    expect(isWeightValid("")).toBe(false);
    expect(isWeightValid("abc")).toBe(false);
  });

  it("pieces optional; when present must be positive integer", () => {
    expect(isPiecesValid("")).toBe(true);
    expect(isPiecesValid("8")).toBe(true);
    expect(isPiecesValid("0")).toBe(false);
    expect(isPiecesValid("1.5")).toBe(false);
    expect(isPiecesValid("-2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Band status (average per bird)
// ---------------------------------------------------------------------------

describe("bandStatus", () => {
  const kgLine = buildLineQueue(fixtureTasks())[0]!; // kg mode, band 1.2–1.5, 40 kg ordered
  const pieceLine = buildLineQueue(fixtureTasks())[1]!; // piece mode, band 1.8–2.2, 12 pcs

  it("is empty when weight missing or invalid", () => {
    expect(bandStatus(kgLine, { weightKg: "", pieces: "" })).toBe("empty");
    expect(bandStatus(kgLine, { weightKg: "0", pieces: "" })).toBe("empty");
  });

  it("uses weight/pieces when pieces entered", () => {
    // 41.6 / 30 = 1.386 → in band 1.2–1.5
    expect(bandStatus(kgLine, { weightKg: "41.6", pieces: "30" })).toBe("in_band");
    // 41.6 / 20 = 2.08 → out of band
    expect(bandStatus(kgLine, { weightKg: "41.6", pieces: "20" })).toBe("out_of_band");
  });

  it("piece mode falls back to ordered quantity when pieces not typed", () => {
    // 24 / 12 = 2.0 → in band 1.8–2.2
    expect(bandStatus(pieceLine, { weightKg: "24", pieces: "" })).toBe("in_band");
    // 30 / 12 = 2.5 → out
    expect(bandStatus(pieceLine, { weightKg: "30", pieces: "" })).toBe("out_of_band");
  });

  it("kg mode without pieces reports delta_only", () => {
    expect(bandStatus(kgLine, { weightKg: "41.6", pieces: "" })).toBe("delta_only");
  });

  it("band boundaries are inclusive", () => {
    expect(bandStatus(pieceLine, { weightKg: "21.6", pieces: "12" })).toBe("in_band"); // 1.8
    expect(bandStatus(pieceLine, { weightKg: "26.4", pieces: "12" })).toBe("in_band"); // 2.2
  });
});

describe("sizeBandTrackPosition", () => {
  it("centers the band and clamps at domain edges", () => {
    // band 1.8–2.2 → domain 1.6–2.4
    expect(sizeBandTrackPosition(2.0, 1.8, 2.2)).toBeCloseTo(0.5);
    expect(sizeBandTrackPosition(1.0, 1.8, 2.2)).toBe(0);
    expect(sizeBandTrackPosition(9.0, 1.8, 2.2)).toBe(1);
  });

  it("survives a zero-width band", () => {
    const pos = sizeBandTrackPosition(2.0, 2.0, 2.0);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Readiness & payload
// ---------------------------------------------------------------------------

describe("readiness and payload", () => {
  it("line ready needs valid weight and valid-or-empty pieces", () => {
    const s = stateWith();
    const line = s.queue[0];
    expect(isLineReady(line!, s.drafts)).toBe(false);
    const filled = fillLine(s, 0, "41.6");
    expect(isLineReady(line!, filled.drafts)).toBe(true);
    const badPieces = fillLine(s, 0, "41.6", "1.5");
    expect(isLineReady(line!, badPieces.drafts)).toBe(false);
  });

  it("task complete only when every line is ready AND confirmed", () => {
    let s = stateWith();
    const taskId = s.queue[0]!.taskId;
    expect(isTaskComplete(s, taskId)).toBe(false);
    s = confirmLine(s, 0, "41.6");
    expect(isTaskComplete(s, taskId)).toBe(false);
    // filled but unconfirmed last line must NOT complete the task
    s = fillLine(s, 1, "24", "12");
    expect(isTaskComplete(s, taskId)).toBe(false);
    s = confirmLine(s, 1, "24", "12");
    expect(isTaskComplete(s, taskId)).toBe(true);
  });

  it("builds payload with numeric coercion, omitting empty pieces", () => {
    let s = stateWith();
    s = fillLine(s, 0, "41.62");
    s = fillLine(s, 1, "24", "12");
    const taskId = s.queue[0]!.taskId;
    const payload = buildCompletePayload(s.queue, s.drafts, taskId);
    expect(payload).toEqual([
      { itemId: s.queue[0]!.itemId, weightKg: 41.62 },
      { itemId: s.queue[1]!.itemId, weightKg: 24, pieces: 12 },
    ]);
  });

  it("finds the first confirmed task not already pending", () => {
    let s = stateWith();
    s = confirmLine(s, 2, "25.4");
    const taskB = s.queue[2]!.taskId;
    expect(firstReadyUnsubmittedTaskId(s, new Set())).toBe(taskB);
    expect(firstReadyUnsubmittedTaskId(s, new Set([taskB]))).toBeNull();
    expect(firstReadyUnsubmittedTaskId(stateWith(), new Set())).toBeNull();
  });

  it("a filled-but-unconfirmed task never submits", () => {
    let s = stateWith();
    s = fillLine(s, 2, "25.4");
    expect(firstReadyUnsubmittedTaskId(s, new Set())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("nextIncompleteIndex searches circularly, skipping confirmed lines", () => {
    let s = stateWith();
    s = confirmLine(s, 1, "24");
    expect(nextIncompleteIndex(s, 0, NOW)).toBe(2); // line 1 confirmed → skip to 2
    expect(nextIncompleteIndex(s, 2, NOW)).toBe(0); // wraps
  });

  it("a filled-but-unconfirmed line still counts as incomplete", () => {
    let s = stateWith();
    s = fillLine(s, 1, "24");
    expect(nextIncompleteIndex(s, 0, NOW)).toBe(1);
  });

  it("returns null when every line is confirmed", () => {
    let s = stateWith();
    s = confirmLine(s, 0, "41.6");
    s = confirmLine(s, 1, "24");
    s = confirmLine(s, 2, "25.4");
    expect(nextIncompleteIndex(s, 0, NOW)).toBeNull();
  });

  it("canUndo only when cursor > 0", () => {
    const s = stateWith();
    expect(canUndo(s)).toBe(false);
    expect(canUndo({ ...s, cursor: 1 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

describe("weighReducer", () => {
  it("DIGIT edits the current line's active target", () => {
    let s = stateWith();
    s = weighReducer(s, { type: "DIGIT", digit: "4" });
    s = weighReducer(s, { type: "DIGIT", digit: "1" });
    expect(s.drafts[s.queue[0]!.itemId]!.weightKg).toBe("41");
    s = weighReducer(s, { type: "TOGGLE_TARGET" });
    s = weighReducer(s, { type: "DIGIT", digit: "3" });
    expect(s.drafts[s.queue[0]!.itemId]!.pieces).toBe("3");
  });

  it("NEXT confirms the current line, advances, and resets target to weight", () => {
    let s = stateWith();
    s = weighReducer(s, { type: "TOGGLE_TARGET" });
    s = fillLine(s, 0, "41.6");
    s = weighReducer(s, { type: "NEXT", nowMs: NOW });
    expect(s.cursor).toBe(1);
    expect(s.entryTarget).toBe("weight");
    expect(s.confirmed[s.queue[0]!.itemId]).toBe(true);
  });

  it("NEXT does not confirm an invalid line", () => {
    let s = stateWith();
    s = weighReducer(s, { type: "NEXT", nowMs: NOW });
    expect(s.confirmed[s.queue[0]!.itemId]).toBeUndefined();
  });

  it("SKIP moves on without confirming", () => {
    let s = stateWith();
    s = fillLine(s, 0, "41.6");
    s = weighReducer(s, { type: "SKIP", nowMs: NOW });
    expect(s.cursor).toBe(1);
    expect(s.confirmed[s.queue[0]!.itemId]).toBeUndefined();
  });

  it("UNDO steps back one line, keeping the draft but unconfirming it", () => {
    let s = stateWith();
    s = fillLine(s, 0, "41.6");
    s = weighReducer(s, { type: "NEXT", nowMs: NOW });
    s = weighReducer(s, { type: "UNDO" });
    expect(s.cursor).toBe(0);
    expect(s.drafts[s.queue[0]!.itemId]!.weightKg).toBe("41.6");
    expect(s.confirmed[s.queue[0]!.itemId]).toBeUndefined();
  });

  it("editing a line unconfirms it", () => {
    let s = stateWith();
    s = confirmLine(s, 0, "41.6");
    s = weighReducer(s, { type: "BACKSPACE" });
    expect(s.confirmed[s.queue[0]!.itemId]).toBeUndefined();
  });

  it("UNDO at start is a no-op", () => {
    const s = stateWith();
    expect(weighReducer(s, { type: "UNDO" }).cursor).toBe(0);
  });

  it("GO_TO clamps to queue bounds", () => {
    const s = stateWith();
    expect(weighReducer(s, { type: "GO_TO", index: 99 }).cursor).toBe(2);
    expect(weighReducer(s, { type: "GO_TO", index: -5 }).cursor).toBe(0);
  });

  it("OPTIMISTIC_COMPLETE removes the task's lines and snapshots them", () => {
    let s = stateWith();
    s = confirmLine(s, 0, "41.6");
    s = confirmLine(s, 1, "24");
    const taskId = s.queue[0]!.taskId;
    s = weighReducer(s, { type: "OPTIMISTIC_COMPLETE", taskId });
    expect(s.queue).toHaveLength(1);
    expect(s.pendingRemovals[taskId]!.removedLines).toHaveLength(2);
    expect(s.pendingRemovals[taskId]!.insertAt).toBe(0);
    expect(s.cursor).toBe(0); // now points at remaining line
  });

  it("COMPLETE_SUCCESS drops the pending snapshot so the saving row disappears", () => {
    let s = stateWith();
    s = confirmLine(s, 0, "41.6");
    s = confirmLine(s, 1, "24");
    const taskId = s.queue[0]!.taskId;
    s = weighReducer(s, { type: "OPTIMISTIC_COMPLETE", taskId });
    expect(s.pendingRemovals[taskId]).toBeDefined();
    s = weighReducer(s, { type: "COMPLETE_SUCCESS", taskId });
    expect(s.pendingRemovals[taskId]).toBeUndefined();
    expect(queueWithPendingRemovals(s.queue, s.pendingRemovals)).toBe(s.queue);
    // unknown taskId is a no-op
    expect(weighReducer(s, { type: "COMPLETE_SUCCESS", taskId: "nope" })).toBe(s);
  });

  it("RESTORE_TASK re-splices lines at original index, drafts intact, lines unconfirmed", () => {
    let s = stateWith();
    s = confirmLine(s, 0, "41.6");
    s = confirmLine(s, 1, "24");
    const taskId = s.queue[0]!.taskId;
    const originalQueue = s.queue.map((l) => l.itemId);
    s = weighReducer(s, { type: "OPTIMISTIC_COMPLETE", taskId });
    s = weighReducer(s, { type: "RESTORE_TASK", taskId });
    expect(s.queue.map((l) => l.itemId)).toEqual(originalQueue);
    expect(s.drafts[s.queue[0]!.itemId]!.weightKg).toBe("41.6");
    expect(s.pendingRemovals[taskId]).toBeUndefined();
    expect(s.cursor).toBe(0);
    // restored lines must be re-confirmed by the user, or the failed submit would loop
    expect(s.confirmed[s.queue[0]!.itemId]).toBeUndefined();
    expect(s.confirmed[s.queue[1]!.itemId]).toBeUndefined();
  });

  it("full flow: typing on the last line never completes the task — NEXT does", () => {
    let s = stateWith();
    const taskId = s.queue[0]!.taskId;
    for (const d of ["4", "1"]) s = weighReducer(s, { type: "DIGIT", digit: d });
    expect(isTaskComplete(s, taskId)).toBe(false);
    s = weighReducer(s, { type: "NEXT", nowMs: NOW });
    for (const d of ["2", "4"]) s = weighReducer(s, { type: "DIGIT", digit: d });
    // both lines now hold valid weights, but line 2 is unconfirmed
    expect(isTaskComplete(s, taskId)).toBe(false);
    s = weighReducer(s, { type: "NEXT", nowMs: NOW });
    expect(isTaskComplete(s, taskId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queueWithPendingRemovals — rail display of orders mid-save
// ---------------------------------------------------------------------------

describe("queueWithPendingRemovals", () => {
  it("returns the queue untouched when nothing is pending", () => {
    const s = stateWith();
    expect(queueWithPendingRemovals(s.queue, s.pendingRemovals)).toBe(s.queue);
  });

  it("splices a pending task back at its original position", () => {
    let s = stateWith();
    const original = s.queue.map((l) => l.itemId);
    s = confirmLine(s, 0, "41.6");
    s = confirmLine(s, 1, "24");
    s = weighReducer(s, { type: "OPTIMISTIC_COMPLETE", taskId: s.queue[0]!.taskId });
    const display = queueWithPendingRemovals(s.queue, s.pendingRemovals);
    expect(display.map((l) => l.itemId)).toEqual(original);
    expect(s.queue).toHaveLength(1); // live queue stays without the saving task
  });

  it("clamps insertAt beyond the current queue length", () => {
    let s = stateWith();
    s = confirmLine(s, 2, "12");
    const lastTaskId = s.queue[2]!.taskId;
    s = weighReducer(s, { type: "OPTIMISTIC_COMPLETE", taskId: lastTaskId });
    const display = queueWithPendingRemovals(s.queue, s.pendingRemovals);
    expect(display).toHaveLength(3);
    expect(display[2]!.taskId).toBe(lastTaskId);
  });
});

// ---------------------------------------------------------------------------
// Claims — blocking, deep-link overrides, and claim reducer actions
// ---------------------------------------------------------------------------

describe("claims", () => {
  it("maps claim fields into state and marks other-active tasks blocked", () => {
    const t1 = makeClaimTask({ weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT });
    const t2 = makeClaimTask();
    const state = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    expect(state.claims[t1.id]).toEqual({ by: "worker-a", at: ACTIVE_AT });
    expect(isTaskBlocked(state, t1.id, NOW)).toBe(true);
    expect(isTaskBlocked(state, t2.id, NOW)).toBe(false);
  });

  it("treats an expired claim as unclaimed", () => {
    const t1 = makeClaimTask({ weigh_claimed_by: "worker-a", weigh_claimed_at: EXPIRED_AT });
    const state = createWeighState([t1], { viewerId: "me", nowMs: NOW });
    expect(isTaskBlocked(state, t1.id, NOW)).toBe(false);
  });

  it("my own claim never blocks me", () => {
    const t1 = makeClaimTask({ weigh_claimed_by: "me", weigh_claimed_at: ACTIVE_AT });
    const state = createWeighState([t1], { viewerId: "me", nowMs: NOW });
    expect(isTaskBlocked(state, t1.id, NOW)).toBe(false);
  });

  it("initial cursor lands on the first non-blocked task", () => {
    const t1 = makeClaimTask({ weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT });
    const t2 = makeClaimTask();
    const state = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    expect(state.queue[state.cursor]?.taskId).toBe(t2.id);
  });

  it("focusOrderId deep link wins even into a blocked task", () => {
    const t1 = makeClaimTask({ weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT });
    const t2 = makeClaimTask();
    const state = createWeighState([t1, t2], {
      viewerId: "me",
      nowMs: NOW,
      focusOrderId: t1.order.id,
    });
    expect(state.queue[state.cursor]?.taskId).toBe(t1.id);
  });

  it("NEXT skips lines of blocked tasks", () => {
    // t1 unblocked (1 line), t2 blocked, t3 unblocked
    const t1 = makeClaimTask();
    const t2 = makeClaimTask({ weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT });
    const t3 = makeClaimTask();
    let state = createWeighState([t1, t2, t3], { viewerId: "me", nowMs: NOW });
    expect(state.queue[state.cursor]!.taskId).toBe(t1.id);
    state = fillLine(state, state.cursor, "5");
    // cursor on t1's line; NEXT with a valid draft must land on t3's line
    state = weighReducer(state, { type: "NEXT", nowMs: NOW });
    expect(state.queue[state.cursor]!.taskId).toBe(t3.id);
  });

  it("CLAIM_LOCAL sets, CLAIM_CLEARED removes", () => {
    const t1 = makeClaimTask();
    let state = createWeighState([t1], { viewerId: "me", nowMs: NOW });
    state = weighReducer(state, { type: "CLAIM_LOCAL", taskId: t1.id, by: "me", at: ACTIVE_AT });
    expect(state.claims[t1.id]).toEqual({ by: "me", at: ACTIVE_AT });
    state = weighReducer(state, { type: "CLAIM_CLEARED", taskId: t1.id });
    expect(state.claims[t1.id]).toBeUndefined();
  });

  it("CLAIM_REJECTED discards the task's drafts and advances off it", () => {
    // type a digit into t1's line, dispatch CLAIM_REJECTED
    const t1 = makeClaimTask();
    const t2 = makeClaimTask();
    let state = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    state = confirmLine(state, 0, "5");
    expect(state.confirmed[state.queue[0]!.itemId]).toBe(true);
    state = weighReducer(state, { type: "CLAIM_REJECTED", taskId: t1.id, nowMs: NOW });
    // expect drafts for t1's items reset to empty, confirmations gone,
    // and cursor on the next non-blocked task
    expect(state.drafts[state.queue[0]!.itemId]).toEqual({ weightKg: "", pieces: "" });
    expect(state.confirmed[state.queue[0]!.itemId]).toBeUndefined();
    expect(state.queue[state.cursor]!.taskId).toBe(t2.id);
  });

  it("CLAIM_REJECTED on a multi-line task advances past all of that task's own lines", () => {
    // t1 has 2 lines; cursor sits on t1's first line when rejected.
    const t1 = makeTask([makeItem({ mode: "kg", quantity: 10 }), makeItem({ mode: "kg", quantity: 5 })]);
    const t2 = makeClaimTask();
    let state = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    expect(state.cursor).toBe(0);
    state = confirmLine(state, 0, "5");
    state = fillLine(state, 1, "3");
    state = weighReducer(state, { type: "CLAIM_REJECTED", taskId: t1.id, nowMs: NOW });
    // both of t1's lines have their drafts reset and confirmations withdrawn
    expect(state.drafts[state.queue[0]!.itemId]).toEqual({ weightKg: "", pieces: "" });
    expect(state.drafts[state.queue[1]!.itemId]).toEqual({ weightKg: "", pieces: "" });
    expect(state.confirmed[state.queue[0]!.itemId]).toBeUndefined();
    expect(state.confirmed[state.queue[1]!.itemId]).toBeUndefined();
    // cursor must land on a genuinely different task, not a sibling line of t1
    expect(state.queue[state.cursor]!.taskId).toBe(t2.id);
  });

  it("CLAIM_REJECTED on the only task in the queue leaves the cursor in place", () => {
    const t1 = makeTask([makeItem({ mode: "kg", quantity: 10 }), makeItem({ mode: "kg", quantity: 5 })]);
    let state = createWeighState([t1], { viewerId: "me", nowMs: NOW });
    state = weighReducer(state, { type: "GO_TO", index: 1 });
    state = weighReducer(state, { type: "CLAIM_REJECTED", taskId: t1.id, nowMs: NOW });
    expect(state.cursor).toBe(1);
    expect(state.drafts[state.queue[1]!.itemId]).toEqual({ weightKg: "", pieces: "" });
  });

  it("CLAIM_REJECTED for a task already completed locally is a no-op (stale rejection after our own COMPLETE_SUCCESS)", () => {
    // Task X completes (OPTIMISTIC_COMPLETE + COMPLETE_SUCCESS) before a
    // late-resolving claim RPC for the same task rejects it — the reducer
    // must not move the cursor or touch drafts for a task no longer queued.
    const t1 = makeClaimTask();
    const t2 = makeClaimTask();
    let state = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    state = fillLine(state, 1, "9"); // draft on the surviving task, to prove it's untouched
    const taskId = t1.id;
    state = weighReducer(state, { type: "OPTIMISTIC_COMPLETE", taskId });
    state = weighReducer(state, { type: "COMPLETE_SUCCESS", taskId });
    expect(state.queue.some((line) => line.taskId === taskId)).toBe(false);
    const cursorBefore = state.cursor;
    const draftsBefore = state.drafts;
    const confirmedBefore = state.confirmed;
    const next = weighReducer(state, { type: "CLAIM_REJECTED", taskId, nowMs: NOW });
    expect(next.cursor).toBe(cursorBefore);
    expect(next.drafts).toBe(draftsBefore);
    expect(next.confirmed).toBe(confirmedBefore);
    expect(next).toBe(state); // fully untouched
  });

  it("falls back to index 0 when every remaining task is blocked, via createWeighState and SYNC_TASKS", () => {
    const t1 = makeClaimTask({ weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT });
    const t2 = makeClaimTask({ weigh_claimed_by: "worker-b", weigh_claimed_at: ACTIVE_AT });
    const allBlocked = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    expect(allBlocked.cursor).toBe(0);
    expect(isTaskBlocked(allBlocked, allBlocked.queue[0]!.taskId, NOW)).toBe(true);

    // same fallback path inside the reducer: cursor is stranded on a task
    // that vanishes, and every task left after the sync is blocked.
    const t3 = makeClaimTask();
    let synced = createWeighState([t3, t1], { viewerId: "me", nowMs: NOW });
    expect(synced.queue[synced.cursor]!.taskId).toBe(t3.id);
    synced = weighReducer(synced, { type: "SYNC_TASKS", tasks: [t1], nowMs: NOW });
    expect(synced.queue.some((line) => line.taskId === t3.id)).toBe(false);
    expect(synced.cursor).toBe(0);
    expect(isTaskBlocked(synced, synced.queue[0]!.taskId, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SYNC_TASKS — merging server truth into local state
// ---------------------------------------------------------------------------

describe("SYNC_TASKS", () => {
  it("preserves drafts, confirmations and cursor for surviving lines", () => {
    // build state from [t1, t2]; type "5" into t1's first line; confirm nothing
    const t1 = makeClaimTask();
    const t2 = makeClaimTask();
    let state = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    state = fillLine(state, 0, "5");
    // sync with fresh [t1, t2] where t2 now carries an active other-claim
    const freshT2 = { ...t2, weigh_claimed_by: "worker-a", weigh_claimed_at: ACTIVE_AT };
    state = weighReducer(state, { type: "SYNC_TASKS", tasks: [t1, freshT2], nowMs: NOW });
    // expect draft "5" kept, cursor unchanged, claims["t2"] set
    expect(state.drafts[state.queue[0]!.itemId]!.weightKg).toBe("5");
    expect(state.cursor).toBe(0);
    expect(state.claims[t2.id]).toEqual({ by: "worker-a", at: ACTIVE_AT });
  });

  it("drops vanished tasks and moves a stranded cursor to the first available task", () => {
    // cursor on t1; sync with fresh [t2] (t1 completed elsewhere)
    const t1 = makeClaimTask();
    const t2 = makeClaimTask();
    let state = createWeighState([t1, t2], { viewerId: "me", nowMs: NOW });
    expect(state.queue[state.cursor]!.taskId).toBe(t1.id);
    state = weighReducer(state, { type: "SYNC_TASKS", tasks: [t2], nowMs: NOW });
    // expect no t1 lines, cursor on t2's first line
    expect(state.queue.some((line) => line.taskId === t1.id)).toBe(false);
    expect(state.queue[state.cursor]!.taskId).toBe(t2.id);
  });

  it("tracks the same itemId under the cursor when the server returns tasks in a different order", () => {
    // Deterministic ordering (fix for the BLOCKER: getTodayTasks now orders
    // by created_at, id) means the server shouldn't actually reshuffle rows,
    // but SYNC_TASKS itself must still be robust to a permuted list — Cursor identity must follow itemId, not array position, whatever order the server returns.
    const t1 = makeClaimTask();
    const t2 = makeClaimTask();
    const t3 = makeClaimTask();
    let state = createWeighState([t1, t2, t3], { viewerId: "me", nowMs: NOW });
    state = weighReducer(state, { type: "GO_TO", index: 1 }); // cursor on t2's line
    state = confirmLine(state, 1, "7");
    const currentItemId = state.queue[state.cursor]!.itemId;

    const permuted = weighReducer(state, { type: "SYNC_TASKS", tasks: [t3, t1, t2], nowMs: NOW });

    expect(permuted.queue[permuted.cursor]!.itemId).toBe(currentItemId);
    expect(permuted.drafts[currentItemId]!.weightKg).toBe("7");
    expect(permuted.confirmed[currentItemId]).toBe(true);
  });

  it("does not resurrect tasks in pendingRemovals", () => {
    // OPTIMISTIC_COMPLETE t1, then SYNC_TASKS with fresh data still containing t1
    const t1 = makeClaimTask();
    let state = createWeighState([t1], { viewerId: "me", nowMs: NOW });
    state = confirmLine(state, 0, "5");
    state = weighReducer(state, { type: "OPTIMISTIC_COMPLETE", taskId: t1.id });
    expect(state.pendingRemovals[t1.id]).toBeDefined();
    state = weighReducer(state, { type: "SYNC_TASKS", tasks: [t1], nowMs: NOW });
    // expect t1 absent from queue (its snapshot stays in pendingRemovals for RESTORE_TASK)
    expect(state.queue.some((line) => line.taskId === t1.id)).toBe(false);
    expect(state.pendingRemovals[t1.id]).toBeDefined();
  });
});
