import { describe, it, expect } from "vitest";
import {
  AcceptInvitationInput,
  ChangeRoleInput,
  ChangeScopeInput,
  CreateOrganizationInput,
  DeactivateUserInput,
  InviteUserInput,
  OpenBreakGlassInput,
  UpdateMemberProfileInput,
  SendPasswordResetInput,
  RemoveMemberInput,
  CreateUserInput,
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
      role: "driver",
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
      role: "driver",
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
        newRole: "driver",
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

const UUID = "11111111-1111-1111-1111-111111111111";

describe("UpdateMemberProfileInput", () => {
  it("accepts a name-only update", () => {
    expect(
      UpdateMemberProfileInput.safeParse({ memberId: UUID, displayName: "Mak Norliza", reason: "correcting the name" }).success,
    ).toBe(true);
  });
  it("accepts an email-only update", () => {
    expect(
      UpdateMemberProfileInput.safeParse({ memberId: UUID, email: "new@ayam.my", reason: "fixing email typo" }).success,
    ).toBe(true);
  });
  it("rejects when neither displayName nor email is given", () => {
    expect(UpdateMemberProfileInput.safeParse({ memberId: UUID, reason: "no operation needed" }).success).toBe(false);
  });
  it("rejects an invalid email", () => {
    expect(
      UpdateMemberProfileInput.safeParse({ memberId: UUID, email: "not-an-email", reason: "fixing email typo" }).success,
    ).toBe(false);
  });
  it("rejects a reason shorter than 10 chars", () => {
    expect(
      UpdateMemberProfileInput.safeParse({ memberId: UUID, displayName: "New Name", reason: "short" }).success,
    ).toBe(false);
  });
});

describe("SendPasswordResetInput", () => {
  it("accepts a member id", () => {
    expect(SendPasswordResetInput.safeParse({ memberId: UUID }).success).toBe(true);
  });
  it("rejects a non-uuid", () => {
    expect(SendPasswordResetInput.safeParse({ memberId: "nope" }).success).toBe(false);
  });
});

describe("RemoveMemberInput", () => {
  it("requires a reason", () => {
    expect(RemoveMemberInput.safeParse({ memberId: UUID }).success).toBe(false);
    expect(RemoveMemberInput.safeParse({ memberId: UUID, reason: "left the farm" }).success).toBe(true);
  });
});

describe("CreateUserInput", () => {
  it("accepts a full payload", () => {
    expect(
      CreateUserInput.safeParse({
        organizationId: UUID,
        email: "staff@ayam.my",
        displayName: "New Staff",
        role: "driver",
      }).success,
    ).toBe(true);
  });
  it("rejects an unknown role", () => {
    expect(
      CreateUserInput.safeParse({
        organizationId: UUID,
        email: "staff@ayam.my",
        displayName: "New Staff",
        role: "superhero",
      }).success,
    ).toBe(false);
  });
  it("accepts a valid clientOperationId UUID", () => {
    expect(
      CreateUserInput.safeParse({
        organizationId: UUID,
        email: "staff@ayam.my",
        displayName: "New Staff",
        role: "driver",
        clientOperationId: "22222222-2222-2222-2222-222222222222",
      }).success,
    ).toBe(true);
  });
  it("rejects an invalid clientOperationId", () => {
    expect(
      CreateUserInput.safeParse({
        organizationId: UUID,
        email: "staff@ayam.my",
        displayName: "New Staff",
        role: "driver",
        clientOperationId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});
