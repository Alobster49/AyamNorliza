/**
 * Pure day-timeline view: trucks as rows, the day as an hour axis, each
 * assigned order as a block at its delivery slot. Risk is derived, never
 * stored: an unready order whose slot start is near (or past) "now" turns
 * amber (atRisk) or red (late). nowMinutes is injected for testability;
 * the client passes local minutes for today and null for other dates.
 */

import type { DispatchBoardData, DispatchTicket, DispatchTruck } from "../types";
import { buildBoardView } from "./dispatch-board-model";
import { totalWeightKg } from "./plan-model";

export type BlockState = "ready" | "pending" | "atRisk" | "late" | "departed";

export type TimelineBlock = {
  ticket: DispatchTicket;
  startMin: number;
  endMin: number;
  startPct: number;
  widthPct: number;
  state: BlockState;
  /** Stacking row within the truck lane; 0 is the topmost. */
  lane: number;
};

export type TimelineRow = {
  truck: DispatchTruck;
  departed: boolean;
  blocks: TimelineBlock[];
  loadKg: number;
  /** How many lanes this row needs to show overlapping blocks side by side. */
  laneCount: number;
};

export type TimelineView = {
  rows: TimelineRow[];
  hours: number[];
  windowStart: number;
  windowEnd: number;
  nowPct: number | null;
  poolCount: number;
};

const AT_RISK_LEAD_MIN = 60;
const DEFAULT_START = 6 * 60;
const DEFAULT_END = 14 * 60;

export function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

function blockState(ticket: DispatchTicket, departed: boolean, startMin: number, nowMinutes: number | null): BlockState {
  if (departed) return "departed";
  if (ticket.status === "ready") return "ready";
  if (nowMinutes !== null) {
    if (startMin <= nowMinutes) return "late";
    if (startMin - nowMinutes <= AT_RISK_LEAD_MIN) return "atRisk";
  }
  return "pending";
}

export function buildTimeline(
  data: DispatchBoardData,
  date: string,
  nowMinutes: number | null,
): TimelineView {
  const board = buildBoardView(data, date);
  const slotById = new Map(data.slots.map((s) => [s.id, s]));
  const boardTrucks = board.bays.flatMap((b) => b.trucks);

  // Window from every scheduled block, padded to whole hours.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const bt of boardTrucks) {
    for (const t of bt.tickets) {
      const slot = slotById.get(t.slot_id);
      if (!slot) continue;
      min = Math.min(min, minutesOf(slot.start_time));
      max = Math.max(max, minutesOf(slot.end_time));
    }
  }
  const windowStart = Number.isFinite(min) ? Math.floor(min / 60) * 60 : DEFAULT_START;
  const windowEnd = Number.isFinite(max) ? Math.max(Math.ceil(max / 60) * 60, windowStart + 120) : DEFAULT_END;
  const span = windowEnd - windowStart;

  const rows: TimelineRow[] = boardTrucks.map((bt) => {
    const blocks: TimelineBlock[] = bt.tickets
      .flatMap((ticket) => {
        const slot = slotById.get(ticket.slot_id);
        if (!slot) return [];
        const startMin = minutesOf(slot.start_time);
        const endMin = Math.max(minutesOf(slot.end_time), startMin + 15);
        return [{
          ticket,
          startMin,
          endMin,
          startPct: ((startMin - windowStart) / span) * 100,
          widthPct: ((endMin - startMin) / span) * 100,
          state: blockState(ticket, bt.departed, startMin, nowMinutes),
          lane: 0,
        }];
      })
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

    // Greedy interval partitioning: reuse the first lane that has already
    // ended by the time this block starts, otherwise open a new one. Without
    // it, same-slot orders on one truck stack on top of each other and only
    // the last is readable.
    const laneEnds: number[] = [];
    for (const block of blocks) {
      let lane = laneEnds.findIndex((end) => end <= block.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(block.endMin);
      } else {
        laneEnds[lane] = block.endMin;
      }
      block.lane = lane;
    }

    return {
      truck: bt.truck,
      departed: bt.departed,
      loadKg: totalWeightKg(bt.tickets),
      blocks,
      laneCount: Math.max(laneEnds.length, 1),
    };
  });

  const hours: number[] = [];
  for (let h = windowStart / 60; h <= windowEnd / 60; h++) hours.push(h);

  const nowPct =
    nowMinutes !== null && nowMinutes >= windowStart && nowMinutes <= windowEnd
      ? ((nowMinutes - windowStart) / span) * 100
      : null;

  return { rows, hours, windowStart, windowEnd, nowPct, poolCount: board.pool.length };
}
