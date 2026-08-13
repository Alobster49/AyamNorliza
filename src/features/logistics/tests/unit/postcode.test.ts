import { describe, expect, it } from "vitest";
import { isValidPostcode, matchZone } from "../../lib/postcode";
import type { ZonePostcodeRange } from "../../types";
import type { DeliveryZone } from "@/features/orders/types";

function zone(id: string, name: string): DeliveryZone {
  return {
    id,
    organization_id: "org-1",
    name,
    display_order: 0,
    is_active: true,
    created_by: null,
    created_at: "",
    updated_at: "",
    version: 1,
  };
}

function range(zoneId: string, start: string, end: string): ZonePostcodeRange {
  return {
    id: `${zoneId}-${start}`,
    organization_id: "org-1",
    zone_id: zoneId,
    postcode_start: start,
    postcode_end: end,
    created_by: null,
    created_at: "",
  };
}

describe("isValidPostcode", () => {
  it("accepts 5 digits", () => {
    expect(isValidPostcode("82000")).toBe(true);
  });
  it("rejects short, long, and non-numeric values", () => {
    expect(isValidPostcode("8200")).toBe(false);
    expect(isValidPostcode("820000")).toBe(false);
    expect(isValidPostcode("82OOO")).toBe(false);
    expect(isValidPostcode("")).toBe(false);
  });
});

describe("matchZone", () => {
  const zones = [zone("z-south", "South"), zone("z-north", "North")];

  it("matches a postcode inside a range", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("82100", ranges, zones)).toBe("z-south");
  });

  it("matches range boundaries inclusively", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("82000", ranges, zones)).toBe("z-south");
    expect(matchZone("82300", ranges, zones)).toBe("z-south");
  });

  it("returns null when no range contains the postcode", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("81900", ranges, zones)).toBe(null);
  });

  it("breaks overlap ties by zone name ascending", () => {
    const ranges = [
      range("z-south", "82000", "82300"),
      range("z-north", "82000", "82300"),
    ];
    // "North" < "South" alphabetically.
    expect(matchZone("82100", ranges, zones)).toBe("z-north");
  });

  it("returns null for an invalid postcode", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("bad", ranges, zones)).toBe(null);
  });

  it("ignores ranges whose zone is missing from the zone list", () => {
    const ranges = [range("z-ghost", "82000", "82300")];
    expect(matchZone("82100", ranges, zones)).toBe(null);
  });
});
