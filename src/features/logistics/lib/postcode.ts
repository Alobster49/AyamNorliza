/**
 * Pure postcode helpers. Malaysian postcodes are exactly 5 digits, so
 * lexicographic comparison on the fixed-length strings equals numeric
 * comparison — no parseInt needed.
 */

import type { DeliveryZone } from "@/features/orders/types";
import { POSTCODE_REGEX, type ZonePostcodeRange } from "../types";

export function isValidPostcode(value: string): boolean {
  return POSTCODE_REGEX.test(value);
}

/**
 * Resolve a postcode to a zone id via the configured ranges. Cross-zone
 * overlap is allowed; the first match ordered by zone name (then id, for
 * stability) wins. Returns null when the postcode is invalid or uncovered.
 */
export function matchZone(
  postcode: string,
  ranges: ZonePostcodeRange[],
  zones: DeliveryZone[],
): string | null {
  if (!isValidPostcode(postcode)) return null;

  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const matched = ranges.filter(
    (r) =>
      zoneById.has(r.zone_id) &&
      postcode >= r.postcode_start &&
      postcode <= r.postcode_end,
  );
  if (matched.length === 0) return null;

  matched.sort((a, b) => {
    const nameA = zoneById.get(a.zone_id)!.name;
    const nameB = zoneById.get(b.zone_id)!.name;
    return nameA.localeCompare(nameB) || a.zone_id.localeCompare(b.zone_id);
  });
  return matched[0]!.zone_id;
}
