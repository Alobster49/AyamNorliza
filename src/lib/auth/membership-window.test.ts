/**
 * The shared "is this membership still live?" predicate. Its whole job is to
 * match the SQL every RLS policy in the schema already uses —
 * `status = 'active' and (expires_at is null or expires_at > now())` — so the
 * app layer and the database agree on who counts as a member.
 */

import { describe, expect, it } from "vitest";

import { activeMembershipWindow } from "./membership-window";

describe("activeMembershipWindow", () => {
  it("admits a permanent membership, which has no expiry at all", () => {
    expect(activeMembershipWindow()).toContain("expires_at.is.null");
  });

  it("admits a temporary membership whose expiry is still in the future", () => {
    expect(activeMembershipWindow()).toMatch(/expires_at\.gt\./);
  });

  it("measures 'in the future' against the current time", () => {
    const before = Date.now();
    const cutoff = activeMembershipWindow().split("expires_at.gt.")[1]!;
    const after = Date.now();

    const parsed = Date.parse(cutoff);
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
  });

  it("offers the two branches as one PostgREST or() filter", () => {
    // `.or()` takes comma-separated alternatives; two separate `.eq()` calls
    // would AND them together and admit nobody.
    expect(activeMembershipWindow().split(",")).toHaveLength(2);
  });
});
