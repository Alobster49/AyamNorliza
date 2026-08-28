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
  highestGrantableRole,
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

  it("farm_manager can invite/scope members but not run access reviews or change roles", () => {
    // access_review.run is owner/org_admin-only in RLS
    // (access_reviews_admin_write, supabase/migrations/20260624000002_id_access_rls.sql),
    // so farm_manager must not hold the capability either.
    expect(can("farm_manager", "access_review.run")).toBe(false);
    expect(can("farm_manager", "membership.role.change")).toBe(false);
    expect(can("farm_manager", "membership.invite")).toBe(true);
  });

  it("remaining org_admin capabilities are correct; farm_manager/supervisor have no audit read", () => {
    expect(can("org_admin", "membership.invite")).toBe(true);
    expect(can("org_admin", "audit.read")).toBe(true);
    // audit_log_select_admin (same migration) restricts audit reads to
    // owner/org_admin, so these roles must not report the capability.
    expect(can("farm_manager", "audit.read")).toBe(false);
    expect(can("supervisor", "audit.read")).toBe(false);
  });

  it("auditor has no MOD-01 capabilities (audit reads are owner/org_admin-only in RLS)", () => {
    expect(can("auditor", "audit.read")).toBe(false);
    expect(can("auditor", "audit_log.read")).toBe(false);
    expect(can("auditor", "membership.role.change")).toBe(false);
    expect(canGrantRole("auditor", "caretaker")).toBe(false);
  });

  it("biosecurity_qa has no audit read capability", () => {
    expect(can("biosecurity_qa", "audit.read")).toBe(false);
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
    // caretaker has no MOD-01 capabilities in the default; grant them
    // membership.invite via override.
    mockRpc.mockResolvedValue({
      data: { caretaker: { "membership.invite": true } },
      error: null,
    });
    const resolved = await resolveCapabilitiesForOrg("00000000-0000-0000-0000-000000000004");
    expect(resolved.caretaker["membership.invite"]).toBe(true);
    // Other capabilities stay at default.
    expect(resolved.caretaker["audit.read"]).toBe(false);
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
