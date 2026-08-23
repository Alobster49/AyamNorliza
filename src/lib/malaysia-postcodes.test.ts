/**
 * Postcode lookup helpers over the vendored dataset. Values asserted here
 * are stable, well-known facts (50000 = Kuala Lumpur; 80000 = Johor
 * Bahru) so the test survives dataset regeneration.
 */
import { describe, expect, it } from "vitest";
import {
  areasForState,
  lookupPostcode,
  statesList,
} from "./malaysia-postcodes";

describe("lookupPostcode", () => {
  it("resolves a known postcode to state and area", () => {
    const hit = lookupPostcode("80000");
    expect(hit?.state).toBe("Johor");
    expect(hit?.area).toMatch(/Johor Bahru/i);
  });

  it("resolves 50000 to Kuala Lumpur", () => {
    expect(lookupPostcode("50000")?.state).toMatch(/Kuala Lumpur/i);
  });

  it("returns null for unknown or malformed postcodes", () => {
    expect(lookupPostcode("99998")).toBeNull();
    expect(lookupPostcode("123")).toBeNull();
    expect(lookupPostcode("")).toBeNull();
  });
});

describe("statesList", () => {
  it("contains all 16 states and federal territories, sorted", () => {
    const states = statesList();
    expect(states.length).toBe(16);
    expect(states).toEqual([...states].sort());
    expect(states).toContain("Johor");
  });
});

describe("areasForState", () => {
  it("lists sorted unique areas for a state", () => {
    const areas = areasForState("Johor");
    expect(areas.length).toBeGreaterThan(5);
    expect(areas).toEqual([...areas].sort());
    expect(new Set(areas).size).toBe(areas.length);
  });

  it("returns empty for unknown state", () => {
    expect(areasForState("Atlantis")).toEqual([]);
  });
});
