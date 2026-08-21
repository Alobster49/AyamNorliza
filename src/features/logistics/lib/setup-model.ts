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

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
