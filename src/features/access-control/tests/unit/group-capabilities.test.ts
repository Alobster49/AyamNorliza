import { describe, it, expect } from "vitest";
import { CAPABILITIES } from "@/lib/auth/permissions";
import { CAPABILITY_GROUPS, groupCapabilities } from "@/features/access-control/lib/group-capabilities";

describe("groupCapabilities", () => {
  it("returns 7 groups with editorial labels", () => {
    expect(CAPABILITY_GROUPS.length).toBe(7);
    expect(CAPABILITY_GROUPS.map((g) => g.label)).toEqual([
      "Organization",
      "Membership",
      "Catalog",
      "Sales",
      "Access review",
      "Break-glass",
      "Audit & auth",
    ]);
  });

  it("contains every capability exactly once across all groups", () => {
    const grouped = groupCapabilities(CAPABILITIES);
    const flat = grouped.flatMap((g) => g.capabilities);
    expect(flat.length).toBe(CAPABILITIES.length);
    expect(new Set(flat).size).toBe(CAPABILITIES.length);
    for (const cap of CAPABILITIES) {
      expect(flat).toContain(cap);
    }
  });

  it("groups the expected capabilities under each category", () => {
    const grouped = groupCapabilities(CAPABILITIES);
    const org = grouped.find((g) => g.label === "Organization");
    expect(org?.capabilities).toEqual([
      "organization.manage",
      "organization.settings.update",
    ]);
    const audit = grouped.find((g) => g.label === "Audit & auth");
    expect(audit?.capabilities).toEqual([
      "audit.read",
      "audit_log.read",
      "auth_security.read",
      "step_up.reauth",
    ]);
  });
});
