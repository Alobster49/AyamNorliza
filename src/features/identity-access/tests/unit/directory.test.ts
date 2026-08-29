import { describe, expect, it } from "vitest";
import { mergeMemberDirectory } from "../../directory";
import type { OrganizationMember } from "../../types";

const member = (id: string, userId: string): OrganizationMember => ({
  id,
  organizationId: "org-1",
  userId,
  role: "driver",
  status: "active",
  startsAt: "2026-01-01T00:00:00Z",
  expiresAt: null,
  invitedBy: null,
  sponsorId: null,
  clientOperationId: null,
});

describe("mergeMemberDirectory", () => {
  it("attaches display name and email by userId", () => {
    const rows = mergeMemberDirectory(
      [member("m1", "u1")],
      new Map([["u1", "Mak Norliza"]]),
      new Map([["u1", "mak@ayam.my"]]),
    );
    expect(rows[0]!.displayName).toBe("Mak Norliza");
    expect(rows[0]!.email).toBe("mak@ayam.my");
  });

  it("falls back to null when a lookup is missing", () => {
    const rows = mergeMemberDirectory([member("m1", "u1")], new Map(), new Map());
    expect(rows[0]!.displayName).toBeNull();
    expect(rows[0]!.email).toBeNull();
  });
});
