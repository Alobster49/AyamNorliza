/**
 * Pure auto-plan draft for the dispatch deck. Reuses suggestTruck (the
 * same rules the per-order auto-assign uses) across the whole pool,
 * incrementing a working load count so proposals respect slot caps
 * against each other, not just against what's already assigned.
 */

import type { DispatchBoardData, DispatchTicket } from "../types";
import { suggestTruck, type AssignmentContext, type AssignmentResult } from "./assignment";
import { buildBoardView } from "./dispatch-board-model";

export type PlanProposal = { orderId: string; truckId: string; zoneId: string; reason: string };
export type ExceptionKind = Extract<AssignmentResult, { ok: false }>["reason"];
export type PlanException = { orderId: string; kind: ExceptionKind; detail: string };
export type PlanDraft = { proposals: PlanProposal[]; exceptions: PlanException[]; poolCount: number };

const EXCEPTION_DETAIL: Record<ExceptionKind, string> = {
  no_postcode: "Order has no postcode — add one on the order first.",
  no_zone_match: "No delivery zone covers this postcode.",
  no_covering_truck: "No truck covers this zone today.",
  all_trucks_full: "Every covering truck is at its slot capacity.",
};

/** Sum of recorded line weights (final wins over warehouse); null when nothing is weighed yet. */
export function orderWeightKg(ticket: DispatchTicket): number | null {
  const weights = (ticket.items ?? [])
    .filter((i) => !i.is_cancelled)
    .map((i) => i.final_weight_kg ?? i.warehouse_weight_kg)
    .filter((w): w is number => w !== null);
  if (weights.length === 0) return null;
  return weights.reduce((a, b) => a + b, 0);
}

export function totalWeightKg(tickets: DispatchTicket[]): number {
  return tickets.reduce((sum, t) => sum + (orderWeightKg(t) ?? 0), 0);
}

export function draftPlan(data: DispatchBoardData, date: string): PlanDraft {
  const slotStartById = new Map(data.slots.map((s) => [s.id, s.start_time]));
  const zoneNameById = new Map(data.zones.map((z) => [z.id, z.name]));

  const loads: Record<string, number> = {};
  for (const o of data.orders) {
    if (o.assignment_source !== "none") loads[o.truck_id] = (loads[o.truck_id] ?? 0) + 1;
  }
  const ctx: AssignmentContext = {
    zones: data.zones,
    ranges: data.ranges,
    truckZones: data.truckZones,
    trucks: data.trucks,
    slots: data.slots,
    blocks: data.blocks,
    loads,
  };

  // Plan from the board's pool, not the raw assignment_source: the board's
  // display safety net also pools tickets sitting on an inactive/bay-less
  // truck, and those need a proposal too (they already sort by slot start).
  const pool = buildBoardView(data, date).pool;

  const proposals: PlanProposal[] = [];
  const exceptions: PlanException[] = [];
  for (const o of pool) {
    const result = suggestTruck(
      { postcode: o.postcode, delivery_date: date, slot_start_time: slotStartById.get(o.slot_id) ?? null },
      ctx,
    );
    if (result.ok) {
      ctx.loads[result.truckId] = (ctx.loads[result.truckId] ?? 0) + 1;
      const slot = slotStartById.get(o.slot_id);
      proposals.push({
        orderId: o.id,
        truckId: result.truckId,
        zoneId: result.zoneId,
        reason: [zoneNameById.get(result.zoneId), slot ? `slot ${slot.slice(0, 5)}` : null, "least loaded"]
          .filter(Boolean)
          .join(" · "),
      });
    } else {
      exceptions.push({ orderId: o.id, kind: result.reason, detail: EXCEPTION_DETAIL[result.reason] });
    }
  }
  return { proposals, exceptions, poolCount: pool.length };
}
