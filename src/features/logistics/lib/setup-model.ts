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
  /**
   * Message key relative to `logistics.setup.readiness`, e.g.
   * "issues.noFacility.title". One line, sentence case, names the record.
   */
  titleKey: string;
  titleValues?: Record<string, string>;
  /**
   * Message key relative to `logistics.setup.readiness`. One line, explains
   * the consequence in business terms.
   */
  detailKey: string;
  detailValues?: Record<string, string>;
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

/** Every unordered pair, so overlap checks read as a single loop. */
function pairs<T>(items: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (const [index, a] of items.entries()) {
    for (const b of items.slice(index + 1)) out.push([a, b]);
  }
  return out;
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
      titleKey: "issues.noFacility.title",
      detailKey: "issues.noFacility.detail",
      target: { entity: "factory", recordId: null },
    });
  }

  for (const zone of liveZones) {
    if (!snapshot.ranges.some((r) => r.zone_id === zone.id)) {
      issues.push({
        id: `zone-no-postcodes:${zone.id}`,
        severity: "blocker",
        titleKey: "issues.zoneNoPostcodes.title",
        titleValues: { zone: zone.name },
        detailKey: "issues.zoneNoPostcodes.detail",
        target: { entity: "postcodes", recordId: zone.id },
      });
    }
    if (!liveLinks.some((tz) => tz.zone_id === zone.id)) {
      issues.push({
        id: `zone-no-truck:${zone.id}`,
        severity: "warning",
        titleKey: "issues.zoneNoTruck.title",
        titleValues: { zone: zone.name },
        detailKey: "issues.zoneNoTruck.detail",
        target: { entity: "zones", recordId: zone.id },
      });
    }
  }

  for (const truck of liveTrucks) {
    if (!liveLinks.some((tz) => tz.truck_id === truck.id)) {
      issues.push({
        id: `truck-no-zone:${truck.id}`,
        severity: "warning",
        titleKey: "issues.truckNoZone.title",
        titleValues: { truck: truck.name },
        detailKey: "issues.truckNoZone.detail",
        target: { entity: "trucks", recordId: truck.id },
      });
    }
    if (!activeSlots.some((s) => s.truck_id === truck.id)) {
      issues.push({
        id: `truck-no-slots:${truck.id}`,
        severity: "warning",
        titleKey: "issues.truckNoSlots.title",
        titleValues: { truck: truck.name },
        detailKey: "issues.truckNoSlots.detail",
        target: { entity: "slots", recordId: truck.id },
      });
    }
  }

  for (const truck of liveTrucks) {
    if (truck.capacity_kg === null) {
      issues.push({
        id: `truck-no-capacity:${truck.id}`,
        severity: "info",
        titleKey: "issues.truckNoCapacity.title",
        titleValues: { truck: truck.name },
        detailKey: "issues.truckNoCapacity.detail",
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
        titleKey: "issues.rangeInverted.title",
        titleValues: { start: range.postcode_start, end: range.postcode_end },
        detailKey: "issues.rangeInverted.detail",
        target: { entity: "postcodes", recordId: range.zone_id },
      });
    }
  }

  const zoneName = (id: string) =>
    snapshot.zones.find((z) => z.id === id)?.name ?? "Unknown zone";

  for (const [a, b] of pairs(liveRanges)) {
    if (a.zone_id === b.zone_id) continue;
    if (a.postcode_start > b.postcode_end || b.postcode_start > a.postcode_end) continue;
    issues.push({
      id: `postcode-overlap:${a.zone_id}:${b.zone_id}`,
      severity: "blocker",
      titleKey: "issues.postcodeOverlap.title",
      titleValues: { zoneA: zoneName(a.zone_id), zoneB: zoneName(b.zone_id) },
      detailKey: "issues.postcodeOverlap.detail",
      detailValues: {
        aStart: a.postcode_start,
        aEnd: a.postcode_end,
        bStart: b.postcode_start,
        bEnd: b.postcode_end,
      },
      target: { entity: "postcodes", recordId: a.zone_id },
    });
  }

  for (const [a, b] of pairs(activeSlots)) {
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
      titleKey: "issues.slotOverlap.title",
      titleValues: { truck: name },
      detailKey: "issues.slotOverlap.detail",
      detailValues: {
        aStart: a.start_time.slice(0, 5),
        aEnd: a.end_time.slice(0, 5),
        bStart: b.start_time.slice(0, 5),
        bEnd: b.end_time.slice(0, 5),
      },
      target: { entity: "slots", recordId: a.truck_id },
    });
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export type SearchHit = {
  entity: SetupEntity;
  /** The record to select in the list pane; null selects the entity only. */
  recordId: string | null;
  /** The record's own name/date — data, never localized. Used when labelKey is unset. */
  label: string;
  /**
   * Set when the label itself is a phrase, not just a record name. Relative
   * to `logistics.setup.search`.
   */
  labelKey?: string;
  labelValues?: Record<string, string>;
  /** Why it matched, shown as secondary text. Relative to `logistics.setup.search.context`. */
  contextKey: string;
  contextValues?: Record<string, string>;
};

/** Keys into `logistics.setup.weekday` / the `weekday` select in search messages, indexed 0 (Sun) through 6 (Sat). */
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Canonical (locale-independent) abbreviations used only to match the query
 * against a slot's day — display always goes through WEEKDAY_KEYS instead.
 */
const MATCH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * One box over all seven entities. A bare five-digit number is treated as a
 * postcode and resolved to the zone that owns it — the question the office
 * gets asked on the phone most often.
 */
export function searchSetup(snapshot: SetupSnapshot, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const hits: SearchHit[] = [];
  const liveZones = snapshot.zones.filter((z) => z.is_active);
  const liveTrucks = snapshot.trucks.filter((t) => t.is_active);

  for (const truck of liveTrucks) {
    if (truck.name.toLowerCase().includes(q) || truck.code.toLowerCase().includes(q)) {
      hits.push({
        entity: "trucks",
        recordId: truck.id,
        label: truck.name,
        contextKey: "context.truck",
        contextValues: { code: truck.code },
      });
    }
  }

  for (const zone of liveZones) {
    if (zone.name.toLowerCase().includes(q)) {
      hits.push({
        entity: "zones",
        recordId: zone.id,
        label: zone.name,
        contextKey: "context.zone",
      });
    }
  }

  if (/^\d{5}$/.test(q)) {
    for (const range of snapshot.ranges) {
      if (q < range.postcode_start || q > range.postcode_end) continue;
      const zone = liveZones.find((z) => z.id === range.zone_id);
      if (!zone) continue;
      hits.push({
        entity: "postcodes",
        recordId: zone.id,
        // Dead for rendering — `labelKey` below always wins in the
        // consumer (setup-console.tsx) — but `label` is a required field
        // on `SearchHit`, so a real fallback string still has to live here.
        label: `${q} — ${zone.name}`,
        labelKey: "postcodeMatch",
        labelValues: { postcode: q, zone: zone.name },
        contextKey: "context.range",
        contextValues: { start: range.postcode_start, end: range.postcode_end },
      });
    }
  }

  for (const block of snapshot.blocks) {
    const reason = block.reason ?? "";
    if (!reason.toLowerCase().includes(q) && !block.block_date.includes(q)) continue;
    const label = reason === "" ? block.block_date : `${block.block_date} · ${reason}`;
    if (block.truck_id === null) {
      hits.push({ entity: "blocks", recordId: block.id, label, contextKey: "context.blockedAllTrucks" });
      continue;
    }
    const truck = snapshot.trucks.find((t) => t.id === block.truck_id);
    hits.push({
      entity: "blocks",
      recordId: block.id,
      label,
      contextKey: truck ? "context.blocked" : "context.blockedUnknownTruck",
      ...(truck ? { contextValues: { truck: truck.name } } : {}),
    });
  }

  for (const bay of snapshot.bays) {
    if (!bay.name.toLowerCase().includes(q)) continue;
    hits.push({ entity: "bays", recordId: bay.id, label: bay.name, contextKey: "context.bay" });
  }

  if (
    snapshot.facility &&
    (snapshot.facility.name.toLowerCase().includes(q) ||
      snapshot.facility.postcode.includes(q))
  ) {
    hits.push({
      entity: "factory",
      recordId: snapshot.facility.id,
      label: snapshot.facility.name,
      contextKey: "context.factory",
      contextValues: { postcode: snapshot.facility.postcode },
    });
  }

  for (const slot of snapshot.slots) {
    if (!slot.is_active) continue;
    const truck = liveTrucks.find((t) => t.id === slot.truck_id);
    if (!truck) continue;
    const start = slot.start_time.slice(0, 5);
    const end = slot.end_time.slice(0, 5);
    const matchLabel = `${MATCH_WEEKDAYS[slot.weekday]} ${start}–${end}`;
    if (!matchLabel.toLowerCase().includes(q)) continue;
    hits.push({
      entity: "slots",
      recordId: slot.truck_id,
      label: matchLabel,
      labelKey: "slotTime",
      labelValues: { weekday: WEEKDAY_KEYS[slot.weekday]!, start, end },
      contextKey: "context.slot",
      contextValues: { truck: truck.name },
    });
  }

  return hits;
}
