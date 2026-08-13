import { describe, expect, it } from "vitest";
import {
  FacilityInputSchema,
  BayInputSchema,
  PostcodeRangeInputSchema,
} from "../../types";

describe("FacilityInputSchema", () => {
  it("accepts a valid facility", () => {
    const result = FacilityInputSchema.safeParse({
      name: "Kilang Ayam",
      addressLine: "Ptd 7904, Batu 31, Kg. Parit Baru, Pontian",
      postcode: "82000",
      state: "Johor",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-5-digit postcode", () => {
    const result = FacilityInputSchema.safeParse({
      name: "Kilang Ayam",
      addressLine: "x",
      postcode: "8200",
      state: "Johor",
    });
    expect(result.success).toBe(false);
  });
});

describe("BayInputSchema", () => {
  it("defaults position and isActive", () => {
    const result = BayInputSchema.safeParse({
      facilityId: "5b1f5c1e-0000-4000-8000-000000000001",
      name: "Bay 1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toBe(0);
      expect(result.data.isActive).toBe(true);
    }
  });
});

describe("PostcodeRangeInputSchema", () => {
  it("rejects end < start", () => {
    const result = PostcodeRangeInputSchema.safeParse({
      zoneId: "5b1f5c1e-0000-4000-8000-000000000001",
      postcodeStart: "82300",
      postcodeEnd: "82000",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a single-postcode range", () => {
    const result = PostcodeRangeInputSchema.safeParse({
      zoneId: "5b1f5c1e-0000-4000-8000-000000000001",
      postcodeStart: "82000",
      postcodeEnd: "82000",
    });
    expect(result.success).toBe(true);
  });
});
