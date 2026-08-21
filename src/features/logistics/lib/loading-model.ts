/**
 * Pure loader-board view: every truck on the board as a lane, and the orders
 * assigned to it as jobs a loader confirms one by one at the bay door.
 *
 * Two rules shape a lane:
 *  - Reverse-route order. Drops are numbered by slot time (drop 1 leaves the
 *    truck first), and the truck is packed in reverse — the last drop goes in
 *    first, deepest, so the driver never unpacks the whole bed at stop one.
 *  - Capacity. Weight is measured against the truck's capacity_kg so a lane
 *    can say how much room is left instead of just how much is on board.
 *
 * Loaded jobs sink to the bottom of the lane as receipts, keeping their drop
 * number so the sequence stays readable after the fact.
 */

import type { DispatchBoardData, DispatchTicket, DispatchTruck } from "../types";
import { buildBoardView } from "./dispatch-board-model";
import { orderWeightKg, totalWeightKg } from "./plan-model";

export type LoadLine = { name: string; quantity: number; pieces: number | null; weightKg: number | null };

export type LoadJob = {
  ticket: DispatchTicket;
  lines: LoadLine[];
  weightKg: number | null;
  loaded: boolean;
  slotStart: string | null;
  /** 1 = first stop of the route, so it loads last and rides at the tail. */
  dropNumber: number;
  totalDrops: number;
};

export type LoadLane = {
  truck: DispatchTruck;
  bayName: string;
  departed: boolean;
  jobs: LoadJob[];
  doneCount: number;
  totalCount: number;
  /** Weight of everything assigned to the truck today. */
  totalKg: number;
  /** Weight already on board. */
  loadedKg: number;
  capacityKg: number | null;
  /** Percent of capacity already on board, clamped to 100. Null without capacity. */
  loadedPct: number | null;
  /** Percent of capacity the full day's load needs, clamped to 100. */
  plannedPct: number | null;
  /** Capacity left after the whole day's load, floored at 0. */
  freeKg: number | null;
  overCapacity: boolean;
  /** The job the loader should carry next, or null when the lane is done. */
  nextJobId: string | null;
};

/** Kept as the single-truck view of a lane; the board and the queue agree. */
export type LoadQueue = LoadLane;

export type LoadTruckSummary = {
  truck: DispatchTruck;
  bayName: string;
  departed: boolean;
  doneCount: number;
  totalCount: number;
  totalKg: number;
};

function toLines(ticket: DispatchTicket): LoadLine[] {
  return (ticket.items ?? [])
    .filter((i) => !i.is_cancelled)
    .map((i) => ({
      name: i.product?.name ?? "Item",
      quantity: i.quantity,
      pieces: i.warehouse_pieces,
      weightKg: i.final_weight_kg ?? i.warehouse_weight_kg,
    }));
}

function pct(part: number, whole: number | null): number | null {
  if (whole === null || whole <= 0) return null;
  return Math.min(100, (part / whole) * 100);
}

function buildLane(
  truck: DispatchTruck,
  bayName: string,
  departed: boolean,
  tickets: DispatchTicket[],
  slotStartById: Map<string, string>,
): LoadLane {
  const slotStart = (t: DispatchTicket) => slotStartById.get(t.slot_id)?.slice(0, 5) ?? null;

  // Delivery order first: earliest slot is drop 1 and comes off the truck first.
  const route = [...tickets].sort(
    (a, b) =>
      (slotStart(a) ?? "").localeCompare(slotStart(b) ?? "") ||
      (a.customer?.name ?? "").localeCompare(b.customer?.name ?? ""),
  );
  const dropByTicketId = new Map(route.map((t, i) => [t.id, i + 1]));

  const jobs: LoadJob[] = route.map((ticket) => ({
    ticket,
    lines: toLines(ticket),
    weightKg: orderWeightKg(ticket),
    loaded: ticket.loaded_at !== null,
    slotStart: slotStart(ticket),
    dropNumber: dropByTicketId.get(ticket.id) ?? 0,
    totalDrops: route.length,
  }));

  // Loading order: pending first, then reverse-route so the last drop goes deepest.
  jobs.sort((a, b) => Number(a.loaded) - Number(b.loaded) || b.dropNumber - a.dropNumber);

  const done = jobs.filter((j) => j.loaded);
  const totalKg = totalWeightKg(tickets);
  const loadedKg = totalWeightKg(done.map((j) => j.ticket));
  const capacityKg = truck.capacity_kg;

  return {
    truck,
    bayName,
    departed,
    jobs,
    doneCount: done.length,
    totalCount: jobs.length,
    totalKg,
    loadedKg,
    capacityKg,
    loadedPct: pct(loadedKg, capacityKg),
    plannedPct: pct(totalKg, capacityKg),
    freeKg: capacityKg === null ? null : Math.max(0, capacityKg - totalKg),
    overCapacity: capacityKg !== null && capacityKg > 0 && totalKg > capacityKg,
    nextJobId: jobs.find((j) => !j.loaded)?.ticket.id ?? null,
  };
}

/** Every truck on today's board as a lane, bay order preserved. */
export function buildLoadBoard(data: DispatchBoardData, date: string): LoadLane[] {
  const board = buildBoardView(data, date);
  const slotStartById = new Map(data.slots.map((s) => [s.id, s.start_time]));
  return board.bays.flatMap((bay) =>
    bay.trucks.map((bt) => buildLane(bt.truck, bay.bay.name, bt.departed, bt.tickets, slotStartById)),
  );
}

export function buildLoadQueue(
  data: DispatchBoardData,
  date: string,
  truckId: string,
): LoadQueue | null {
  return buildLoadBoard(data, date).find((lane) => lane.truck.id === truckId) ?? null;
}

export function truckSummaries(data: DispatchBoardData, date: string): LoadTruckSummary[] {
  return buildLoadBoard(data, date).map((lane) => ({
    truck: lane.truck,
    bayName: lane.bayName,
    departed: lane.departed,
    doneCount: lane.doneCount,
    totalCount: lane.totalCount,
    totalKg: lane.totalKg,
  }));
}
