/**
 * Malaysian mobile normalization. Accepted inputs are local (01…),
 * country-prefixed (601…, +601…) with spaces/dashes/parens tolerated;
 * output is E.164 +601XXXXXXXX (10 or 11 national digits). Anything else
 * is rejected with null.
 */
import { describe, expect, it } from "vitest";
import { normalizeMalaysianMobile } from "../../lib/phone";

describe("normalizeMalaysianMobile", () => {
  it.each([
    ["0123456789", "+60123456789"],
    ["012-345 6789", "+60123456789"],
    ["01133456789", "+601133456789"], // 11-digit mobile
    ["+60123456789", "+60123456789"],
    ["60123456789", "+60123456789"],
    ["+60 12-345 6789", "+60123456789"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeMalaysianMobile(input)).toBe(expected);
  });

  it.each([
    "",             // empty
    "abc",          // letters
    "0323456789",   // landline (03), not mobile
    "012345678",    // too short
    "012345678901", // too long
    "+65 9123 4567" // wrong country
  ])("rejects %s", (input) => {
    expect(normalizeMalaysianMobile(input)).toBeNull();
  });
});
