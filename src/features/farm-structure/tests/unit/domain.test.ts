import { describe, expect, it } from "vitest";
import {
  buildIdentifierPayload,
  calculateHierarchyCompleteness,
  formatLabelCode,
  hashTargetProfileDefinition,
  validateTargetCurvePoints,
} from "@/features/farm-structure/domain";

describe("calculateHierarchyCompleteness", () => {
  it("marks a draft site incomplete until it has active houses, zones, storage, and contacts", () => {
    const result = calculateHierarchyCompleteness({
      site: {
        status: "draft",
        name: "Pontian Layer Farm",
        code: "PTN",
        timeZone: "Asia/Kuala_Lumpur",
        defaultUnitSystem: "metric",
        contacts: [],
      },
      zones: [{ status: "active" }],
      houses: [],
      storageLocations: [{ status: "active" }],
    });

    expect(result.ready).toBe(false);
    expect(result.score).toBe(60);
    expect(result.missing).toEqual(["site must be active", "at least one active house", "site contact"]);
  });

  it("marks an active site complete when required structure exists", () => {
    const result = calculateHierarchyCompleteness({
      site: {
        status: "active",
        name: "Pontian Layer Farm",
        code: "PTN",
        timeZone: "Asia/Kuala_Lumpur",
        defaultUnitSystem: "metric",
        contacts: [{ name: "Farm manager", phone: "+60123456789" }],
      },
      zones: [{ status: "active" }],
      houses: [{ status: "active" }],
      storageLocations: [{ status: "active" }],
    });

    expect(result).toEqual({ ready: true, score: 100, missing: [] });
  });
});

describe("validateTargetCurvePoints", () => {
  it("rejects duplicate metric and age points", () => {
    const result = validateTargetCurvePoints([
      {
        metric: "body_weight",
        ageStartDay: 1,
        ageEndDay: 7,
        targetValue: 120,
        minValue: 100,
        maxValue: 140,
        unit: "g",
      },
      {
        metric: "body_weight",
        ageStartDay: 1,
        ageEndDay: 7,
        targetValue: 121,
        minValue: 100,
        maxValue: 140,
        unit: "g",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("body_weight has a duplicate point for days 1-7");
  });

  it("rejects overlapping ranges and mixed units for one metric", () => {
    const result = validateTargetCurvePoints([
      {
        metric: "feed_intake",
        ageStartDay: 1,
        ageEndDay: 7,
        targetValue: 90,
        minValue: 70,
        maxValue: 110,
        unit: "g_per_bird_day",
      },
      {
        metric: "feed_intake",
        ageStartDay: 7,
        ageEndDay: 14,
        targetValue: 0.1,
        minValue: 0.08,
        maxValue: 0.12,
        unit: "kg_per_bird_day",
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("feed_intake mixes units: g_per_bird_day, kg_per_bird_day");
    expect(result.errors).toContain("feed_intake has overlapping age ranges at day 7");
  });
});

describe("hashTargetProfileDefinition", () => {
  it("produces a deterministic hash independent of input order", () => {
    const first = hashTargetProfileDefinition({
      profile: { family: "layer-standard", breed: "lohmann", housingSystem: "cage" },
      points: [
        { metric: "egg_weight", ageStartDay: 140, ageEndDay: 147, targetValue: 55, unit: "g" },
        { metric: "lay_rate", ageStartDay: 140, ageEndDay: 147, targetValue: 0.8, unit: "percent" },
      ],
    });
    const second = hashTargetProfileDefinition({
      points: [
        { metric: "lay_rate", ageStartDay: 140, ageEndDay: 147, targetValue: 0.8, unit: "percent" },
        { metric: "egg_weight", ageStartDay: 140, ageEndDay: 147, targetValue: 55, unit: "g" },
      ],
      profile: { housingSystem: "cage", breed: "lohmann", family: "layer-standard" },
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });
});

describe("formatLabelCode", () => {
  it("formats durable entity labels with an organization prefix and short id", () => {
    expect(
      formatLabelCode({
        organizationSlug: "ayam-norliza-pilot",
        entityType: "house",
        entityCode: "H01",
        entityId: "11111111-2222-3333-4444-555555555555",
      }),
    ).toBe("ANP-HOUSE-H01-11111111");
  });
});

describe("buildIdentifierPayload", () => {
  it("builds a stable resolver path without exposing tenant secrets", () => {
    expect(
      buildIdentifierPayload({
        baseUrl: "https://ops.example.com/",
        organizationSlug: "ayam-norliza-pilot",
        printableCode: "ANP-HOUSE-H01-11111111",
      }),
    ).toBe("https://ops.example.com/ayam-norliza-pilot/scan?code=ANP-HOUSE-H01-11111111");
  });
});
