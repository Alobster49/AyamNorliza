/**
 * Pure view model for the dispatch board. Groups the raw board data into
 * bays -> trucks -> tickets, and derives the pool. Display-level safety
 * net: tickets whose truck is inactive, bay-less, or missing render in the
 * pool even if assignment_source says assigned — the data stays untouched,
 * the board just refuses to show a ticket on an undispatchable truck.
 */

import type { DeliveryRun } from "@/features/orders/types";
import type { Bay, DispatchBoardData, DispatchTicket, DispatchTruck } from "../types";
import { weekdayOf } from "./assignment";
import { matchZone } from "./postcode";

export type BoardTruck = {
  truck: DispatchTruck;
  run: DeliveryRun | null;
  departed: boolean;
  tickets: DispatchTicket[];
  load: number;
  cap: number | null;
};

export type BoardBay = { bay: Bay; trucks: BoardTruck[] };

export type DispatchBoardView = {
  pool: DispatchTicket[];
  bays: BoardBay[];
};

export function buildBoardView(data: DispatchBoardData, date: string): DispatchBoardView {
  const weekday = weekdayOf(date);
  const truckById = new Map(data.trucks.map((t) => [t.id, t]));
  const activeBayIds = new Set(data.bays.filter((b) => b.is_active).map((b) => b.id));
  const onBoard = (t: DispatchTruck | undefined): t is DispatchTruck =>
    t !== undefined && t.is_active && t.bay_id !== null && activeBayIds.has(t.bay_id);

  const pool: DispatchTicket[] = [];
  const byTruck = new Map<string, DispatchTicket[]>();
  for (const order of data.orders) {
    const assignedTruck = truckById.get(order.truck_id);
    if (order.assignment_source === "none" || !onBoard(assignedTruck)) {
      pool.push(order);
    } else {
      const list = byTruck.get(order.truck_id) ?? [];
      list.push(order);
      byTruck.set(order.truck_id, list);
    }
  }

  const slotStartById = new Map(data.slots.map((s) => [s.id, s.start_time]));
  const slotStart = (t: DispatchTicket): string => slotStartById.get(t.slot_id) ?? "";
  const ticketSort = (a: DispatchTicket, b: DispatchTicket) =>
    slotStart(a).localeCompare(slotStart(b)) ||
    (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "");
  pool.sort(ticketSort);

  const capFor = (truckId: string): number | null => {
    const caps = data.slots
      .filter((s) => s.truck_id === truckId && s.is_active && s.weekday === weekday)
      .map((s) => s.max_orders);
    const bounded = caps.filter((c): c is number => c !== null);
    if (caps.length === 0 || bounded.length === 0) return null;
    return Math.min(...bounded);
  };

  const bays: BoardBay[] = data.bays
    .filter((b) => b.is_active)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((b) => ({
      bay: b,
      trucks: data.trucks
        .filter((t) => t.bay_id === b.id && t.is_active)
        .sort((a, z) => a.code.localeCompare(z.code))
        .map((t) => {
          const run = data.runs.find((r) => r.truck_id === t.id && r.run_date === date) ?? null;
          const tickets = (byTruck.get(t.id) ?? []).sort(ticketSort);
          return {
            truck: t,
            run,
            departed: run?.status === "departed" || run?.status === "completed",
            tickets,
            load: tickets.length,
            cap: capFor(t.id),
          };
        }),
    }));

  return { pool, bays };
}

/**
 * A truck can't depart while a 'ready' ticket on it was never signed off by
 * the loading screen (loaded_at is null) -- dispatch_depart_truck and
 * set_run_status both reject that with 'not_loaded' now (see
 * 20260828000002_depart_loading_gate.sql), mirroring the hard gate
 * driver_start_run already enforces for the driver deck. Tickets that
 * aren't 'ready' are unaffected -- the office's own escape hatch drops them
 * back to the pool on depart instead of blocking it.
 */
export function hasUnloadedReadyTickets(tickets: DispatchTicket[]): boolean {
  return tickets.some((t) => t.status === "ready" && t.loaded_at === null);
}

/** Trucks whose zone coverage includes the ticket's matched zone. */
export function compatibleTruckIds(
  ticket: DispatchTicket,
  data: DispatchBoardData,
): Set<string> {
  if (!ticket.postcode) return new Set();
  const zoneId = matchZone(ticket.postcode, data.ranges, data.zones);
  if (!zoneId) return new Set();
  return new Set(
    data.truckZones.filter((tz) => tz.zone_id === zoneId).map((tz) => tz.truck_id),
  );
}
