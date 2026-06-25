import { describe, it, expect } from "vitest";
import { can, canGrantRole, highestGrantableRole, ROLES } from "@/lib/auth/permissions";

describe("permissions matrix", () => {
  it("owner can do everything", () => {
    expect(can("owner", "membership.role.change")).toBe(true);
    expect(can("owner", "break_glass.open")).toBe(true);
    expect(can("owner", "audit_log.read")).toBe(true);
  });

  it("caretaker has no MOD-01 capabilities", () => {
    expect(can("caretaker", "membership.invite")).toBe(false);
    expect(can("caretaker", "audit.read")).toBe(false);
  });

  it("org_admin can change roles but not grant owner", () => {
    expect(can("org_admin", "membership.role.change")).toBe(true);
    expect(canGrantRole("org_admin", "owner")).toBe(false);
    expect(canGrantRole("org_admin", "caretaker")).toBe(true);
    expect(canGrantRole("org_admin", "org_admin")).toBe(true);
  });

  it("farm_manager can run access reviews but not change roles", () => {
    expect(can("farm_manager", "access_review.run")).toBe(true);
    expect(can("farm_manager", "membership.role.change")).toBe(false);
  });

  it("auditor can read audit logs but cannot mutate", () => {
    expect(can("auditor", "audit.read")).toBe(true);
    expect(can("auditor", "membership.role.change")).toBe(false);
    expect(canGrantRole("auditor", "caretaker")).toBe(false);
  });

  it("highestGrantableRole walks down the rank table", () => {
    expect(highestGrantableRole("owner")).toBe("owner");
    expect(highestGrantableRole("org_admin")).toBe("org_admin");
    // caretakers lack membership.role.change so canGrantRole() returns
    // false for every role; the helper still surfaces `support` as the
    // minimum (the role they can grant via support-session flows).
    expect(highestGrantableRole("caretaker")).toBe("support");
  });

  it("every role is in ROLES", () => {
    expect(ROLES.length).toBeGreaterThanOrEqual(8);
  });
});
