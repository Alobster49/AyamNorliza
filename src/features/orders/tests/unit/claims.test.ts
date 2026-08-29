import { describe, expect, it } from "vitest";
import { CLAIM_TTL_MS, isClaimActive } from "@/lib/claims";

describe("isClaimActive", () => {
  const now = Date.parse("2026-08-29T08:00:00.000Z");

  it("is false for null", () => {
    expect(isClaimActive(null, now)).toBe(false);
  });

  it("is true just inside the TTL", () => {
    const at = new Date(now - CLAIM_TTL_MS + 1000).toISOString();
    expect(isClaimActive(at, now)).toBe(true);
  });

  it("is false exactly at the TTL boundary", () => {
    const at = new Date(now - CLAIM_TTL_MS).toISOString();
    expect(isClaimActive(at, now)).toBe(false);
  });

  it("is false for garbage timestamps", () => {
    expect(isClaimActive("not-a-date", now)).toBe(false);
  });
});
