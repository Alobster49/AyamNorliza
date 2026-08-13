/**
 * Pure auto-assignment: pick the best truck for an order. No DB access —
 * the server action loads the context and applies the result. Manual
 * assignments are never overwritten here or in the RPC
 * (dispatch_assign_order ignores p_source='auto' over 'manual').
 *
 * A truck is a candidate when it: is active, sits in a bay, covers the
 * order's zone, is not blocked on the delivery date, and has an active
 * slot matching the order's weekday + start time. Among candidates under
 * their slot cap, least-loaded wins; ties break by lowest truck code.
 */

import type {
  DeliverySlot,
  DeliveryZone,
  ScheduleBlock,
  TruckZone,
} from "@/features/orders/types";
import type { DispatchTruck, ZonePostcodeRange } from "../types";
import { matchZone } from "./postcode";

export type AssignmentContext = {
  zones: DeliveryZone[];
  ranges: ZonePostcodeRange[];
  truckZones: TruckZone[];
  trucks: DispatchTruck[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
  loads: Record<string, number>;
};

export type AssignmentResult =
  | { ok: true; truckId: string; zoneId: string }
  | { ok: false; reason: "no_postcode" | "no_zone_match" | "no_covering_truck" | "all_trucks_full" };

/** "YYYY-MM-DD" -> 0..6 (0=Sunday). Parses as local date parts, no UTC drift. */
export function weekdayOf(dateString: string): number {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getDay();
}

export function suggestTruck(
  order: { postcode: string | null; delivery_date: string; slot_start_time: string | null },
  ctx: AssignmentContext,
): AssignmentResult {
  if (!order.postcode) return { ok: false, reason: "no_postcode" };

  const zoneId = matchZone(order.postcode, ctx.ranges, ctx.zones);
  if (!zoneId) return { ok: false, reason: "no_zone_match" };

  const weekday = weekdayOf(order.delivery_date);
  const coveringIds = new Set(
    ctx.truckZones.filter((tz) => tz.zone_id === zoneId).map((tz) => tz.truck_id),
  );
  const blockedAll = ctx.blocks.some(
    (b) => b.block_date === order.delivery_date && b.truck_id === null,
  );
  const blockedIds = new Set(
    ctx.blocks
      .filter((b) => b.block_date === order.delivery_date && b.truck_id !== null)
      .map((b) => b.truck_id as string),
  );

  const slotFor = (truckId: string): DeliverySlot | undefined =>
    ctx.slots.find(
      (s) =>
        s.truck_id === truckId &&
        s.is_active &&
        s.weekday === weekday &&
        (order.slot_start_time === null || s.start_time.startsWith(order.slot_start_time)),
    );

  const candidates = ctx.trucks.filter(
    (t) =>
      t.is_active &&
      t.bay_id !== null &&
      coveringIds.has(t.id) &&
      !blockedAll &&
      !blockedIds.has(t.id) &&
      slotFor(t.id) !== undefined,
  );
  if (candidates.length === 0) return { ok: false, reason: "no_covering_truck" };

  const underCap = candidates.filter((t) => {
    const cap = slotFor(t.id)!.max_orders;
    return cap === null || (ctx.loads[t.id] ?? 0) < cap;
  });
  if (underCap.length === 0) return { ok: false, reason: "all_trucks_full" };

  underCap.sort(
    (a, b) => (ctx.loads[a.id] ?? 0) - (ctx.loads[b.id] ?? 0) || a.code.localeCompare(b.code),
  );
  return { ok: true, truckId: underCap[0]!.id, zoneId };
}
