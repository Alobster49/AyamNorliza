/**
 * Pure loader-queue view: the orders assigned to one truck, as jobs a
 * loader confirms one by one at the bay door. Unloaded jobs come first
 * (by slot, then customer); loaded jobs sink to the bottom as receipts.
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
};

export type LoadQueue = {
  truck: DispatchTruck;
  departed: boolean;
  jobs: LoadJob[];
  doneCount: number;
  totalCount: number;
  totalKg: number;
  loadedKg: number;
};

export type LoadTruckSummary = {
  truck: DispatchTruck;
  bayName: string;
  departed: boolean;
  doneCount: number;
  totalCount: number;
  totalKg: number;
};

function toJob(ticket: DispatchTicket, slotStartById: Map<string, string>): LoadJob {
  return {
    ticket,
    lines: (ticket.items ?? [])
      .filter((i) => !i.is_cancelled)
      .map((i) => ({
        name: i.product?.name ?? "Item",
        quantity: i.quantity,
        pieces: i.warehouse_pieces,
        weightKg: i.final_weight_kg ?? i.warehouse_weight_kg,
      })),
    weightKg: orderWeightKg(ticket),
    loaded: ticket.loaded_at !== null,
    slotStart: slotStartById.get(ticket.slot_id)?.slice(0, 5) ?? null,
  };
}

export function buildLoadQueue(
  data: DispatchBoardData,
  date: string,
  truckId: string,
): LoadQueue | null {
  const board = buildBoardView(data, date);
  const bt = board.bays.flatMap((b) => b.trucks).find((t) => t.truck.id === truckId);
  if (!bt) return null;

  const slotStartById = new Map(data.slots.map((s) => [s.id, s.start_time]));
  const jobs = bt.tickets.map((t) => toJob(t, slotStartById));
  jobs.sort(
    (a, b) =>
      Number(a.loaded) - Number(b.loaded) ||
      (a.slotStart ?? "").localeCompare(b.slotStart ?? "") ||
      (a.ticket.customer?.name ?? "").localeCompare(b.ticket.customer?.name ?? ""),
  );

  const done = jobs.filter((j) => j.loaded);
  return {
    truck: bt.truck,
    departed: bt.departed,
    jobs,
    doneCount: done.length,
    totalCount: jobs.length,
    totalKg: totalWeightKg(bt.tickets),
    loadedKg: totalWeightKg(done.map((j) => j.ticket)),
  };
}

export function truckSummaries(data: DispatchBoardData, date: string): LoadTruckSummary[] {
  const board = buildBoardView(data, date);
  return board.bays.flatMap((bay) =>
    bay.trucks.map((bt) => ({
      truck: bt.truck,
      bayName: bay.bay.name,
      departed: bt.departed,
      doneCount: bt.tickets.filter((t) => t.loaded_at !== null).length,
      totalCount: bt.tickets.length,
      totalKg: totalWeightKg(bt.tickets),
    })),
  );
}
