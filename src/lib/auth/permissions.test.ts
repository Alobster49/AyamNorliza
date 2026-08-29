/**
 * Unit tests for the canonical MOD-01 capability matrix and the
 * database-backed capability resolution pipeline that layers per-org
 * overrides on top of the matrix.
 *
 * The async helpers (`resolveCapabilitiesForOrg`, `canForOrg`) read from
 * Supabase via a thin wrapper; we stub the wrapper via vi.mock so the
 * tests stay pure and don't need a running database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { canForOrg, resolveCapabilitiesForOrg } from "./permissions.server";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

const mockRpc = vi.fn();

beforeEach(() => {
  mockRpc.mockReset();
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    rpc: mockRpc,
  } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
});

afterEach(() => {
  vi.clearAllMocks();
});

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

  it("owner always has every capability regardless of override state", async () => {
    mockRpc.mockResolvedValue({
      data: {
        // Even a hostile override payload cannot strip owner permissions
        // (DB rejects the row anyway, but the helper also defensive-merges).
        owner: Object.fromEntries(CAPABILITIES.map((c) => [c, false])),
      },
      error: null,
    });
    for (const c of CAPABILITIES) {
      expect(await canForOrg("00000000-0000-0000-0000-000000000001", "owner", c)).toBe(true);
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

  it("resolveCapabilitiesForOrg returns the canonical matrix when there are no overrides", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000002");
    for (const r of ROLES) {
      for (const c of CAPABILITIES) {
        expect(resolved[r][c]).toBe(can(r, c));
      }
    }
  });

  it("resolveCapabilitiesForOrg fails closed to the canonical matrix when RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000003");
    for (const r of ROLES) {
      for (const c of CAPABILITIES) {
        expect(resolved[r][c]).toBe(can(r, c));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Override semantics
// ---------------------------------------------------------------------------

describe("override semantics", () => {
  it("grants a capability that the default matrix disables", async () => {
    // driver has no MOD-01 capabilities in the default; grant them
    // membership.invite via override.
    mockRpc.mockResolvedValue({
      data: { driver: { "membership.invite": true } },
      error: null,
    });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000004");
    expect(resolved.driver["membership.invite"]).toBe(true);
    // Other capabilities stay at default.
    expect(resolved.driver["audit.read"]).toBe(false);
  });

  it("revokes a capability that the default matrix enables", async () => {
    mockRpc.mockResolvedValue({
      data: { org_admin: { "audit_log.read": false } },
      error: null,
    });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000005");
    expect(resolved.org_admin["audit_log.read"]).toBe(false);
    expect(resolved.org_admin["audit.read"]).toBe(true);
  });

  it("preserves step_up.reauth even when the override sets it to false", async () => {
    mockRpc.mockResolvedValue({
      data: { org_admin: { "step_up.reauth": false } },
      error: null,
    });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000006");
    expect(resolved.org_admin["step_up.reauth"]).toBe(can("org_admin", "step_up.reauth"));
  });

  it("ignores overrides on the owner role (structural lock)", async () => {
    mockRpc.mockResolvedValue({
      data: { owner: { "organization.manage": false, "audit.read": false } },
      error: null,
    });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000007");
    for (const c of CAPABILITIES) {
      expect(resolved.owner[c]).toBe(can("owner", c));
    }
  });

  it("owner role rows for unknown roles in the DB payload are ignored", async () => {
    // Hostile / malformed payload -- should not crash.
    mockRpc.mockResolvedValue({
      data: { _bogus_role: { "step_up.reauth": true } },
      error: null,
    });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000008");
    for (const r of ROLES) {
      for (const c of CAPABILITIES) {
        expect(resolved[r][c]).toBe(can(r, c));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// canForOrg convenience wrapper
// ---------------------------------------------------------------------------

describe("canForOrg", () => {
  it("reflects overrides for overridable capabilities", async () => {
    mockRpc.mockResolvedValue({
      data: { supervisor: { "membership.invite": true } },
      error: null,
    });
    const result = await canForOrg(
      "00000000-0000-0000-0000-000000000009",
      "supervisor",
      "membership.invite",
    );
    expect(result).toBe(true);
  });

  it("returns false for ungranted capabilities", async () => {
    mockRpc.mockResolvedValue({
      data: { supervisor: {} },
      error: null,
    });
    // supervisor does not have `membership.invite` in the default matrix,
    // and no override exists -> resolution falls back to the canonical
    // matrix and returns false.
    const result = await canForOrg(
      "00000000-0000-0000-0000-00000000000a",
      "supervisor",
      "membership.invite",
    );
    expect(result).toBe(false);
  });
});

// Suppress unused-import warnings for Capability / Role types -- they are
// part of the public surface that downstream tests will reach for.
const _unused_types: Capability | Role | undefined = undefined;
void _unused_types;
