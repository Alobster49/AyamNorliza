/**
 * Unit tests for `groupOwnerEmailsByLocale` — the recipient-resolution
 * step of the break-glass owner notification.
 *
 * Regression guard: `openBreakGlassAction` used to pass membership
 * `user_id` UUIDs straight to `sendEmail({ to })`, so Resend rejected
 * every owner notification. Recipients must always be email addresses.
 */

import { describe, expect, it } from "vitest";

import { groupOwnerEmailsByLocale } from "../../server/break-glass-recipients";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("groupOwnerEmailsByLocale", () => {
  it("returns email addresses, never user-id UUIDs", () => {
    const groups = groupOwnerEmailsByLocale([
      { userId: UUID_A, email: "owner-a@example.com", locale: "en" },
      { userId: UUID_B, email: "owner-b@example.com", locale: "en" },
    ]);

    const recipients = [...groups.values()].flat();
    expect(recipients).toEqual(["owner-a@example.com", "owner-b@example.com"]);
    for (const recipient of recipients) {
      expect(recipient).toContain("@");
      expect(recipient).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it("groups owners by their profile locale", () => {
    const groups = groupOwnerEmailsByLocale([
      { userId: UUID_A, email: "en-owner@example.com", locale: "en" },
      { userId: UUID_B, email: "ms-owner@example.com", locale: "ms" },
    ]);

    expect(groups.get("en")).toEqual(["en-owner@example.com"]);
    expect(groups.get("ms")).toEqual(["ms-owner@example.com"]);
  });

  it("falls back to the default locale for missing or unknown locales", () => {
    const groups = groupOwnerEmailsByLocale([
      { userId: UUID_A, email: "no-profile@example.com", locale: undefined },
      { userId: UUID_B, email: "legacy@example.com", locale: "zz" },
    ]);

    expect(groups.get("en")).toEqual(["no-profile@example.com", "legacy@example.com"]);
    expect(groups.size).toBe(1);
  });

  it("drops owners whose email could not be resolved instead of emailing a UUID", () => {
    const groups = groupOwnerEmailsByLocale([
      { userId: UUID_A, email: null, locale: "en" },
      { userId: UUID_B, email: "owner-b@example.com", locale: "en" },
    ]);

    expect([...groups.values()].flat()).toEqual(["owner-b@example.com"]);
  });

  it("returns an empty map when no owner has an email", () => {
    const groups = groupOwnerEmailsByLocale([{ userId: UUID_A, email: null, locale: "en" }]);
    expect(groups.size).toBe(0);
  });
});
