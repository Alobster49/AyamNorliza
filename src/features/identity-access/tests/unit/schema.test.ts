import { describe, it, expect } from "vitest";
import {
  AcceptInvitationInput,
  ChangeRoleInput,
  ChangeScopeInput,
  CreateOrganizationInput,
  DeactivateUserInput,
  InviteUserInput,
  OpenBreakGlassInput,
  OpenSupportSessionInput,
} from "@/features/identity-access/schema";

describe("CreateOrganizationInput", () => {
  it("accepts a minimal valid input", () => {
    const r = CreateOrganizationInput.safeParse({ slug: "ayam-norliza", name: "Ayam Norliza" });
    expect(r.success).toBe(true);
  });
  it("rejects bad slugs", () => {
    expect(CreateOrganizationInput.safeParse({ slug: "BadSlug", name: "x" }).success).toBe(false);
    expect(CreateOrganizationInput.safeParse({ slug: "x", name: "x" }).success).toBe(false);
    expect(CreateOrganizationInput.safeParse({ slug: "a".repeat(50), name: "x" }).success).toBe(false);
  });
});

describe("InviteUserInput", () => {
  it("requires email/role", () => {
    const r = InviteUserInput.safeParse({
      organizationId: "11111111-1111-1111-1111-111111111111",
      email: "x@example.com",
      role: "caretaker",
      scopes: [],
    });
    expect(r.success).toBe(true);
  });
  it("rejects unknown role", () => {
    const r = InviteUserInput.safeParse({
      organizationId: "11111111-1111-1111-1111-111111111111",
      email: "x@example.com",
      role: "admin",
      scopes: [],
    });
    expect(r.success).toBe(false);
  });
  it("rejects scopes with multiple resource ids", () => {
    const r = InviteUserInput.safeParse({
      organizationId: "11111111-1111-1111-1111-111111111111",
      email: "x@example.com",
      role: "caretaker",
      scopes: [
        { siteId: "11111111-1111-1111-1111-111111111111", zoneId: "22222222-2222-2222-2222-222222222222" },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("ChangeRoleInput", () => {
  it("requires a reason with 10+ chars", () => {
    expect(
      ChangeRoleInput.safeParse({
        memberId: "11111111-1111-1111-1111-111111111111",
        newRole: "caretaker",
        reason: "too short",
      }).success,
    ).toBe(false);
  });
});

describe("ChangeScopeInput", () => {
  it("accepts an empty scope set", () => {
    expect(
      ChangeScopeInput.safeParse({
        memberId: "11111111-1111-1111-1111-111111111111",
        scopes: [],
        reason: "revoke all access for offboarded user",
      }).success,
    ).toBe(true);
  });
});

describe("DeactivateUserInput", () => {
  it("requires a reason", () => {
    expect(
      DeactivateUserInput.safeParse({
        memberId: "11111111-1111-1111-1111-111111111111",
        reason: "offboarded",
      }).success,
    ).toBe(true);
  });
});

describe("OpenSupportSessionInput", () => {
  const orgId = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";
  it("rejects >24h windows", () => {
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    expect(
      OpenSupportSessionInput.safeParse({
        organizationId: orgId,
        sponsorId: userId,
        technicianId: userId,
        purpose: "Database migration support",
        permittedScopes: [],
        startsAt,
        endsAt,
      }).success,
    ).toBe(false);
  });
  it("accepts a 2h window", () => {
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(
      OpenSupportSessionInput.safeParse({
        organizationId: orgId,
        sponsorId: userId,
        technicianId: userId,
        purpose: "Database migration support",
        permittedScopes: [],
        startsAt,
        endsAt,
      }).success,
    ).toBe(true);
  });
});

describe("OpenBreakGlassInput", () => {
  it("caps duration at 60", () => {
    expect(
      OpenBreakGlassInput.safeParse({
        organizationId: "11111111-1111-1111-1111-111111111111",
        reason: "Investigating a P0 outage",
        durationMinutes: 120,
      }).success,
    ).toBe(false);
  });
});

describe("AcceptInvitationInput", () => {
  it("requires a token", () => {
    expect(AcceptInvitationInput.safeParse({ token: "x" }).success).toBe(false);
    expect(AcceptInvitationInput.safeParse({ token: "a".repeat(40) }).success).toBe(true);
  });
});
