/**
 * Unit tests for the canonical MOD-01 capability matrix.
 *
 * The database-backed half of this module (`role_capability_overrides`,
 * `effective_capabilities`, and the `resolveCapabilitiesForOrg` /
 * `canForOrg` wrappers) was removed in
 * 20260901000007_drop_legacy_capability_overrides.sql: it had been
 * superseded by dynamic RBAC and had no production caller left. What
 * remains here is the pure matrix, which still backs `can()` and the rank
 * ladder.
 */

import { describe, expect, it } from "vitest";
import {
  can,
  canGrantRole,
  getRoleRank,
  ROLES,
  CAPABILITIES,
  EDITABLE_ROLES,
  buildDefaultCapabilities,
  isCapabilityOverridable,
  isRoleEditable,
  type Capability,
  type Role,
} from "./permissions";

// ---------------------------------------------------------------------------
// Canonical matrix (regression coverage for the hard-coded defaults)
// ---------------------------------------------------------------------------

describe("permissions matrix", () => {
  it("owner can do everything", () => {
    expect(can("owner", "membership.role.change")).toBe(true);
    expect(can("owner", "break_glass.open")).toBe(true);
    expect(can("owner", "audit_log.read")).toBe(true);
  });

  it("driver has no MOD-01 capabilities", () => {
    expect(can("driver", "membership.invite")).toBe(false);
    expect(can("driver", "audit.read")).toBe(false);
  });

  it("org_admin can change roles but not grant owner", () => {
    expect(can("org_admin", "membership.role.change")).toBe(true);
    const adminRank = getRoleRank("org_admin");
    expect(canGrantRole(adminRank, getRoleRank("owner"), true)).toBe(false);
    expect(canGrantRole(adminRank, getRoleRank("driver"), true)).toBe(true);
    expect(canGrantRole(adminRank, getRoleRank("org_admin"), true)).toBe(true);
    // The third argument is the caller's `membership.role.change` capability
    // (resolved via `actorCan` in production) -- without it, no grant is
    // ever allowed regardless of rank.
    expect(canGrantRole(adminRank, getRoleRank("driver"), false)).toBe(false);
  });

  it("org_admin has every capability (full access)", () => {
    for (const c of CAPABILITIES) {
      expect(can("org_admin", c)).toBe(true);
    }
  });

  it("supervisor mirrors seller", () => {
    for (const c of CAPABILITIES) {
      expect(can("supervisor", c)).toBe(can("seller", c));
    }
    // audit_log_select_admin restricts audit reads to owner/org_admin, so
    // sales roles must not report the capability.
    expect(can("supervisor", "audit.read")).toBe(false);
  });

  it("exactly the seven realigned roles exist", () => {
    expect([...ROLES]).toEqual([
      "owner", "org_admin", "hr", "seller", "supervisor", "driver", "inventory",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe("structural invariants", () => {
  it("owner is the only non-editable role", () => {
    expect(EDITABLE_ROLES).not.toContain("owner");
    expect(EDITABLE_ROLES.length).toBe(ROLES.length - 1);
    for (const r of EDITABLE_ROLES) {
      expect(isRoleEditable(r)).toBe(true);
    }
    expect(isRoleEditable("owner")).toBe(false);
  });

  it("step_up.reauth is non-overridable for every role", () => {
    expect(isCapabilityOverridable("step_up.reauth")).toBe(false);
    // Every other capability is overridable.
    for (const c of CAPABILITIES) {
      if (c === "step_up.reauth") continue;
      expect(isCapabilityOverridable(c)).toBe(true);
    }
  });

});

// ---------------------------------------------------------------------------
// Default matrix parity
// ---------------------------------------------------------------------------

describe("default capability resolution", () => {
  it("buildDefaultCapabilities matches the canonical can() helper", () => {
    const defaults = buildDefaultCapabilities();
    for (const r of ROLES) {
      for (const c of CAPABILITIES) {
        expect(defaults[r].has(c)).toBe(can(r, c));
      }
    }
  });
});
