/**
 * Pure derivation over the whole delivery setup: what is misconfigured, and
 * what does a given search string match. Nothing here touches the network —
 * the page already loads every row it needs, so readiness is a fold over
 * state, not a query. Archived records (is_active = false) are invisible to
 * every check: retiring a truck must not raise an issue about it.
 */

import type {
  DeliverySlot,
  DeliveryZone,
  ScheduleBlock,
  Truck,
  TruckZone,
} from "@/features/orders/types";
import type { Bay, Facility, ZonePostcodeRange } from "../types";

export type SetupEntity =
  | "zones"
  | "trucks"
  | "slots"
  | "blocks"
  | "factory"
  | "bays"
  | "postcodes";

export type IssueSeverity = "blocker" | "warning" | "info";

export type SetupIssue = {
  /** Stable key, unique per issue instance. Used as the React key. */
  id: string;
  severity: IssueSeverity;
  /** One line, sentence case, names the record. */
  title: string;
  /** One line, explains the consequence in business terms. */
  detail: string;
  /** Where the Fix button navigates. recordId is null when the fix is "add one". */
  target: { entity: SetupEntity; recordId: string | null };
};

export type SetupSnapshot = {
  zones: DeliveryZone[];
  trucks: Truck[];
  truckZones: TruckZone[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
  facility: Facility | null;
  bays: Bay[];
  ranges: ZonePostcodeRange[];
};

const SEVERITY_ORDER: Record<IssueSeverity, number> = { blocker: 0, warning: 1, info: 2 };

/** "08:00:00" and "08:00" both become 480. */
export function minutesOfTime(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

/** Half-open intervals: touching at a boundary is not an overlap. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function findIssues(snapshot: SetupSnapshot): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const liveZones = snapshot.zones.filter((z) => z.is_active);
  const liveTrucks = snapshot.trucks.filter((t) => t.is_active);
  const liveTruckIds = new Set(liveTrucks.map((t) => t.id));
  const liveZoneIds = new Set(liveZones.map((z) => z.id));
  const liveLinks = snapshot.truckZones.filter(
    (tz) => liveTruckIds.has(tz.truck_id) && liveZoneIds.has(tz.zone_id),
  );
  const activeSlots = snapshot.slots.filter(
    (s) => s.is_active && liveTruckIds.has(s.truck_id),
  );

  if (snapshot.facility === null) {
    issues.push({
      id: "no-facility",
      severity: "blocker",
      title: "No factory address set",
      detail: "Dispatch cannot plan routes or print delivery orders without it.",
      target: { entity: "factory", recordId: null },
    });
  }

  for (const zone of liveZones) {
    if (!snapshot.ranges.some((r) => r.zone_id === zone.id)) {
      issues.push({
        id: `zone-no-postcodes:${zone.id}`,
        severity: "blocker",
        title: `${zone.name} has no postcodes`,
        detail: "No customer address can be matched to this zone at checkout.",
        target: { entity: "postcodes", recordId: zone.id },
      });
    }
    if (!liveLinks.some((tz) => tz.zone_id === zone.id)) {
      issues.push({
        id: `zone-no-truck:${zone.id}`,
        severity: "warning",
        title: `No truck covers ${zone.name}`,
        detail: "Orders in this zone will never be auto-assigned on the dispatch board.",
        target: { entity: "zones", recordId: zone.id },
      });
    }
  }

  for (const truck of liveTrucks) {
    if (!liveLinks.some((tz) => tz.truck_id === truck.id)) {
      issues.push({
        id: `truck-no-zone:${truck.id}`,
        severity: "warning",
        title: `${truck.name} serves no zone`,
        detail: "Auto-plan will skip this truck, so it stays idle.",
        target: { entity: "trucks", recordId: truck.id },
      });
    }
    if (!activeSlots.some((s) => s.truck_id === truck.id)) {
      issues.push({
        id: `truck-no-slots:${truck.id}`,
        severity: "warning",
        title: `${truck.name} has no delivery slots`,
        detail: "Customers cannot book a delivery date on this truck.",
        target: { entity: "slots", recordId: truck.id },
      });
    }
  }

  for (const truck of liveTrucks) {
    if (truck.capacity_kg === null) {
      issues.push({
        id: `truck-no-capacity:${truck.id}`,
        severity: "info",
        title: `${truck.name} has no capacity set`,
        detail: "Load planning cannot warn when this truck is overbooked.",
        target: { entity: "trucks", recordId: truck.id },
      });
    }
  }

  const liveRanges = snapshot.ranges.filter((r) => liveZoneIds.has(r.zone_id));
  for (const range of liveRanges) {
    if (range.postcode_start > range.postcode_end) {
      issues.push({
        id: `range-inverted:${range.id}`,
        severity: "warning",
        title: `Postcode range ${range.postcode_start}–${range.postcode_end} is backwards`,
        detail: "The start is higher than the end, so it matches nothing.",
        target: { entity: "postcodes", recordId: range.zone_id },
      });
    }
  }

  const zoneName = (id: string) =>
    snapshot.zones.find((z) => z.id === id)?.name ?? "Unknown zone";

  for (let i = 0; i < liveRanges.length; i += 1) {
    for (let j = i + 1; j < liveRanges.length; j += 1) {
      const a = liveRanges[i];
      const b = liveRanges[j];
      if (a.zone_id === b.zone_id) continue;
      if (a.postcode_start > b.postcode_end || b.postcode_start > a.postcode_end) continue;
      issues.push({
        id: `postcode-overlap:${a.zone_id}:${b.zone_id}`,
        severity: "blocker",
        title: `${zoneName(a.zone_id)} and ${zoneName(b.zone_id)} claim the same postcodes`,
        detail: `${a.postcode_start}–${a.postcode_end} overlaps ${b.postcode_start}–${b.postcode_end}. Whichever zone sorts first silently wins.`,
        target: { entity: "postcodes", recordId: a.zone_id },
      });
    }
  }

  for (let i = 0; i < activeSlots.length; i += 1) {
    for (let j = i + 1; j < activeSlots.length; j += 1) {
      const a = activeSlots[i];
      const b = activeSlots[j];
      if (a.truck_id !== b.truck_id || a.weekday !== b.weekday) continue;
      const isOverlapping = overlaps(
        minutesOfTime(a.start_time),
        minutesOfTime(a.end_time),
        minutesOfTime(b.start_time),
        minutesOfTime(b.end_time),
      );
      if (!isOverlapping) continue;
      const name = snapshot.trucks.find((t) => t.id === a.truck_id)?.name ?? "Truck";
      issues.push({
        id: `slot-overlap:${a.id}:${b.id}`,
        severity: "warning",
        title: `${name} has two slots at the same time`,
        detail: `${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)} overlaps ${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}. Capacity is counted twice.`,
        target: { entity: "slots", recordId: a.truck_id },
      });
    }
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
