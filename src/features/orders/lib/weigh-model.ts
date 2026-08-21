/**
 * Pure model for the warehouse weigh flow (tasks page).
 *
 * Flattens today's tasks into a queue of weighable lines, holds numpad draft
 * state, and decides when a task's lines are complete enough to submit via
 * completeTask. No React, no DOM — unit tested in tests/unit/weigh-model.test.ts.
 */

import type { OrderItemMode, TaskWithOrder } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WeighLine = {
  taskId: string;
  itemId: string;
  productName: string;
  customerName: string;
  orderId: string;
  orderIdShort: string;
  truckCode: string;
  mode: OrderItemMode;
  orderedQuantity: number;
  sizeMinKg: number;
  sizeMaxKg: number;
  slotWindow: { start: string; end: string } | null;
  /** 1-based position within the task's non-cancelled lines. */
  indexInTask: number;
  totalInTask: number;
};

export type LineDraft = { weightKg: string; pieces: string };

export type EntryTarget = "weight" | "pieces";

export type WeighState = {
  queue: WeighLine[];
  cursor: number;
  drafts: Record<string, LineDraft>;
  /** Lines explicitly confirmed via Next/Save. Editing a line unconfirms it. */
  confirmed: Record<string, true>;
  entryTarget: EntryTarget;
  /** Snapshots of optimistically removed tasks, keyed by taskId. */
  pendingRemovals: Record<string, { removedLines: WeighLine[]; insertAt: number }>;
};

export type WeighAction =
  | { type: "DIGIT"; digit: string }
  | { type: "DOT" }
  | { type: "BACKSPACE" }
  | { type: "TOGGLE_TARGET" }
  | { type: "NEXT" }
  | { type: "SKIP" }
  | { type: "UNDO" }
  | { type: "GO_TO"; index: number }
  | { type: "OPTIMISTIC_COMPLETE"; taskId: string }
  | { type: "RESTORE_TASK"; taskId: string };

export type BandStatus = "empty" | "in_band" | "out_of_band" | "delta_only";

const EMPTY_DRAFT: LineDraft = { weightKg: "", pieces: "" };

// ---------------------------------------------------------------------------
// Queue construction
// ---------------------------------------------------------------------------

export function buildLineQueue(tasks: TaskWithOrder[]): WeighLine[] {
  const queue: WeighLine[] = [];
  for (const task of tasks) {
    const items = task.order.items.filter((item) => !item.is_cancelled);
    items.forEach((item, index) => {
      queue.push({
        taskId: task.id,
        itemId: item.id,
        productName: item.product?.name ?? "Unknown product",
        customerName: task.order.customer?.name ?? "Unknown customer",
        orderId: task.order.id,
        orderIdShort: task.order.id.slice(0, 8),
        truckCode: task.order.truck?.code ?? "-",
        mode: item.mode,
        orderedQuantity: item.quantity,
        sizeMinKg: item.size_min_kg,
        sizeMaxKg: item.size_max_kg,
        slotWindow: task.order.slot
          ? {
              start: task.order.slot.start_time.slice(0, 5),
              end: task.order.slot.end_time.slice(0, 5),
            }
          : null,
        indexInTask: index + 1,
        totalInTask: items.length,
      });
    });
  }
  return queue;
}

/** First queue index belonging to an order, or -1 when it has no lines. */
export function indexOfOrder(queue: WeighLine[], orderId: string): number {
  return queue.findIndex((line) => line.orderId === orderId);
}

/** `focusOrderId` opens the station on that order — used by "Weigh now" links. */
export function createWeighState(tasks: TaskWithOrder[], focusOrderId?: string): WeighState {
  const queue = buildLineQueue(tasks);
  const focused = focusOrderId ? indexOfOrder(queue, focusOrderId) : -1;
  return {
    queue,
    cursor: focused === -1 ? 0 : focused,
    drafts: Object.fromEntries(queue.map((line) => [line.itemId, { ...EMPTY_DRAFT }])),
    confirmed: {},
    entryTarget: "weight",
    pendingRemovals: {},
  };
}

export type TaskGroup = {
  taskId: string;
  customerName: string;
  orderIdShort: string;
  truckCode: string;
  lines: WeighLine[];
};

export function groupQueueByTask(queue: WeighLine[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  for (const line of queue) {
    const last = groups[groups.length - 1];
    if (last && last.taskId === line.taskId) {
      last.lines.push(line);
    } else {
      groups.push({
        taskId: line.taskId,
        customerName: line.customerName,
        orderIdShort: line.orderIdShort,
        truckCode: line.truckCode,
        lines: [line],
      });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Numpad buffer edits
// ---------------------------------------------------------------------------

const MAX_INT_DIGITS = 4;
const MAX_DECIMALS = 3;

export function applyDigit(buffer: string, digit: string, target: EntryTarget): string {
  if (!/^[0-9]$/.test(digit)) return buffer;
  if (target === "pieces") {
    if (buffer.length >= MAX_INT_DIGITS) return buffer;
    if (buffer === "0") return digit;
    return buffer + digit;
  }
  const dotIndex = buffer.indexOf(".");
  if (dotIndex === -1) {
    if (buffer === "0") return digit === "0" ? buffer : digit;
    if (buffer.length >= MAX_INT_DIGITS) return buffer;
    return buffer + digit;
  }
  if (buffer.length - dotIndex - 1 >= MAX_DECIMALS) return buffer;
  return buffer + digit;
}

export function applyDot(buffer: string): string {
  if (buffer.includes(".")) return buffer;
  return buffer === "" ? "0." : buffer + ".";
}

export function applyBackspace(buffer: string): string {
  return buffer.slice(0, -1);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isWeightValid(weightKg: string): boolean {
  if (weightKg.trim() === "") return false;
  const value = Number(weightKg);
  return Number.isFinite(value) && value > 0 && value <= 1000;
}

export function isPiecesValid(pieces: string): boolean {
  if (pieces.trim() === "") return true;
  const value = Number(pieces);
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------
// Band status — average weight per bird
// ---------------------------------------------------------------------------

/**
 * Average kg per bird for the entered draft, or null when it can't be derived
 * (kg-mode line with no pieces entered).
 */
export function averageBirdKg(line: WeighLine, draft: LineDraft): number | null {
  const weight = Number(draft.weightKg);
  if (!isWeightValid(draft.weightKg)) return null;
  if (draft.pieces.trim() !== "" && isPiecesValid(draft.pieces)) {
    return weight / Number(draft.pieces);
  }
  if (line.mode === "piece" && line.orderedQuantity > 0) {
    return weight / line.orderedQuantity;
  }
  return null;
}

export function bandStatus(line: WeighLine, draft: LineDraft): BandStatus {
  if (!isWeightValid(draft.weightKg)) return "empty";
  const avg = averageBirdKg(line, draft);
  if (avg === null) return "delta_only";
  return avg >= line.sizeMinKg && avg <= line.sizeMaxKg ? "in_band" : "out_of_band";
}

/**
 * Marker position (0..1) on a track whose domain extends the band by half a
 * band-width on each side, so the accepted band sits centered.
 */
export function sizeBandTrackPosition(value: number, minKg: number, maxKg: number): number {
  const span = Math.max(maxKg - minKg, 0.1);
  const domainMin = minKg - span / 2;
  const domainMax = maxKg + span / 2;
  const fraction = (value - domainMin) / (domainMax - domainMin);
  return Math.min(1, Math.max(0, fraction));
}

// ---------------------------------------------------------------------------
// Readiness & payload
// ---------------------------------------------------------------------------

export function isLineReady(line: WeighLine, drafts: Record<string, LineDraft>): boolean {
  const draft = drafts[line.itemId] ?? EMPTY_DRAFT;
  return isWeightValid(draft.weightKg) && isPiecesValid(draft.pieces);
}

/**
 * A task is complete when every line has been explicitly confirmed (Next /
 * Save) with valid values. Mere draft validity is not enough — otherwise
 * typing the first digit of the last line would submit the order.
 */
export function isTaskComplete(state: WeighState, taskId: string): boolean {
  const lines = state.queue.filter((line) => line.taskId === taskId);
  return (
    lines.length > 0 &&
    lines.every((line) => state.confirmed[line.itemId] && isLineReady(line, state.drafts))
  );
}

export function buildCompletePayload(
  queue: WeighLine[],
  drafts: Record<string, LineDraft>,
  taskId: string,
): { itemId: string; weightKg: number; pieces?: number }[] {
  return queue
    .filter((line) => line.taskId === taskId)
    .map((line) => {
      const draft = drafts[line.itemId] ?? EMPTY_DRAFT;
      const entry: { itemId: string; weightKg: number; pieces?: number } = {
        itemId: line.itemId,
        weightKg: Number(draft.weightKg),
      };
      if (draft.pieces.trim() !== "") entry.pieces = Number(draft.pieces);
      return entry;
    });
}

export function firstReadyUnsubmittedTaskId(
  state: WeighState,
  pending: ReadonlySet<string>,
): string | null {
  const seen = new Set<string>();
  for (const line of state.queue) {
    if (seen.has(line.taskId)) continue;
    seen.add(line.taskId);
    if (pending.has(line.taskId) || state.pendingRemovals[line.taskId]) continue;
    if (isTaskComplete(state, line.taskId)) return line.taskId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Next unconfirmed line after `from`, searching circularly. Null when all confirmed. */
export function nextIncompleteIndex(state: WeighState, from: number): number | null {
  const { queue } = state;
  if (queue.length === 0) return null;
  for (let step = 1; step <= queue.length; step++) {
    const index = (from + step) % queue.length;
    const line = queue[index];
    if (line && !state.confirmed[line.itemId]) return index;
  }
  return null;
}

export function canUndo(state: WeighState): boolean {
  return state.cursor > 0;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function updateCurrentDraft(state: WeighState, edit: (draft: LineDraft) => LineDraft): WeighState {
  const line = state.queue[state.cursor];
  if (!line) return state;
  const draft = state.drafts[line.itemId] ?? EMPTY_DRAFT;
  // Editing a confirmed line withdraws its confirmation until re-confirmed.
  const confirmed = { ...state.confirmed };
  delete confirmed[line.itemId];
  return { ...state, confirmed, drafts: { ...state.drafts, [line.itemId]: edit(draft) } };
}

function unconfirm(confirmed: Record<string, true>, itemIds: string[]): Record<string, true> {
  const next = { ...confirmed };
  for (const id of itemIds) delete next[id];
  return next;
}

function clampCursor(queue: WeighLine[], cursor: number): number {
  if (queue.length === 0) return 0;
  return Math.min(Math.max(cursor, 0), queue.length - 1);
}

function advance(state: WeighState): WeighState {
  const next = nextIncompleteIndex(state, state.cursor);
  return { ...state, cursor: next ?? state.cursor, entryTarget: "weight" };
}

export function weighReducer(state: WeighState, action: WeighAction): WeighState {
  switch (action.type) {
    case "DIGIT":
      return updateCurrentDraft(state, (draft) =>
        state.entryTarget === "weight"
          ? { ...draft, weightKg: applyDigit(draft.weightKg, action.digit, "weight") }
          : { ...draft, pieces: applyDigit(draft.pieces, action.digit, "pieces") },
      );
    case "DOT":
      if (state.entryTarget === "pieces") return state;
      return updateCurrentDraft(state, (draft) => ({ ...draft, weightKg: applyDot(draft.weightKg) }));
    case "BACKSPACE":
      return updateCurrentDraft(state, (draft) =>
        state.entryTarget === "weight"
          ? { ...draft, weightKg: applyBackspace(draft.weightKg) }
          : { ...draft, pieces: applyBackspace(draft.pieces) },
      );
    case "TOGGLE_TARGET":
      return { ...state, entryTarget: state.entryTarget === "weight" ? "pieces" : "weight" };
    case "NEXT": {
      const line = state.queue[state.cursor];
      const confirmed =
        line && isLineReady(line, state.drafts)
          ? { ...state.confirmed, [line.itemId]: true as const }
          : state.confirmed;
      return advance({ ...state, confirmed });
    }
    case "SKIP":
      return advance(state);
    case "UNDO": {
      if (!canUndo(state)) return state;
      const cursor = state.cursor - 1;
      const target = state.queue[cursor];
      return {
        ...state,
        cursor,
        entryTarget: "weight",
        confirmed: target ? unconfirm(state.confirmed, [target.itemId]) : state.confirmed,
      };
    }
    case "GO_TO":
      return { ...state, cursor: clampCursor(state.queue, action.index), entryTarget: "weight" };
    case "OPTIMISTIC_COMPLETE": {
      const insertAt = state.queue.findIndex((line) => line.taskId === action.taskId);
      if (insertAt === -1) return state;
      const removedLines = state.queue.filter((line) => line.taskId === action.taskId);
      const queue = state.queue.filter((line) => line.taskId !== action.taskId);
      const currentItemId = state.queue[state.cursor]?.itemId;
      const survivingIndex = queue.findIndex((line) => line.itemId === currentItemId);
      const cursor = survivingIndex !== -1 ? survivingIndex : clampCursor(queue, insertAt);
      return {
        ...state,
        queue,
        cursor,
        pendingRemovals: {
          ...state.pendingRemovals,
          [action.taskId]: { removedLines, insertAt },
        },
      };
    }
    case "RESTORE_TASK": {
      const snapshot = state.pendingRemovals[action.taskId];
      if (!snapshot) return state;
      const queue = [...state.queue];
      queue.splice(snapshot.insertAt, 0, ...snapshot.removedLines);
      const pendingRemovals = { ...state.pendingRemovals };
      delete pendingRemovals[action.taskId];
      return {
        ...state,
        queue,
        cursor: snapshot.insertAt,
        entryTarget: "weight",
        pendingRemovals,
        // Force the user back through Next on each restored line — otherwise a
        // failed submit would immediately resubmit the same payload forever.
        confirmed: unconfirm(state.confirmed, snapshot.removedLines.map((l) => l.itemId)),
      };
    }
    default:
      return state;
  }
}
