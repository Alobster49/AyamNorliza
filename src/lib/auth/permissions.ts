/**
 * Capability-based permission helpers.
 *
 * Roles are managed collections of capabilities. A role never widens the
 * caller's own delegated authority (see MOD-01 §6.7).
 *
 * The canonical matrix below is the **default** role/capability set;
 * organization owners can override individual capabilities on top of this
 * via the `role_capability_overrides` table (resolved by the
 * `effective_capabilities` DB helper). On the server-side hot path the
 * canonical matrix is consulted via `can(role, capability)`, which is
 * intentionally synchronous and DB-free so every Server Action can check
 * permission without paying for a round-trip. The DB-backed override
 * resolution is exposed through `canForOrg(...)` and is consulted by the
 * Roles & Permissions settings UI to render the resolved matrix; future
 * inline enforcement can swap callers to `canForOrg` without changing
 * signatures.
 *
 * RLS independently enforces the same defaults in the database.
 */

export const ROLES = [
  "owner",
  "org_admin",
  "seller",
  "farm_manager",
  "supervisor",
  "caretaker",
  "veterinarian",
  "biosecurity_qa",
  "maintenance",
  "inventory",
  "logistics",
  "auditor",
  "support",
] as const;

export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "organization.manage",
  "organization.settings.update",
  "membership.invite",
  "membership.role.change",
  "membership.scope.change",
  "membership.deactivate",
  "access_review.run",
  "access_review.decide",
  "support_session.open",
  "support_session.end",
  "break_glass.open",
  "break_glass.finalize",
  "audit.read",
  "audit_log.read",
  "auth_security.read",
  "step_up.reauth",
  "catalog.manage",
  "orders.manage",
  "customers.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const matrix: Record<Role, ReadonlySet<Capability>> = {
  owner: new Set<Capability>(CAPABILITIES),
  org_admin: new Set<Capability>([
    "organization.manage",
    "organization.settings.update",
    "membership.invite",
    "membership.role.change",
    "membership.scope.change",
    "membership.deactivate",
    "access_review.run",
    "access_review.decide",
    "support_session.open",
    "support_session.end",
    "audit.read",
    "audit_log.read",
    "auth_security.read",
    "step_up.reauth",
    "catalog.manage",
    "orders.manage",
    "customers.manage",
  ]),
  seller: new Set<Capability>([
    "catalog.manage",
    "orders.manage",
    "customers.manage",
    "step_up.reauth",
  ]),
  farm_manager: new Set<Capability>([
    "membership.invite",
    "membership.scope.change",
    "access_review.run",
    "audit.read",
    "step_up.reauth",
  ]),
  supervisor: new Set<Capability>([
    "audit.read",
    "step_up.reauth",
  ]),
  caretaker: new Set<Capability>([]),
  veterinarian: new Set<Capability>([
    "step_up.reauth",
  ]),
  biosecurity_qa: new Set<Capability>([
    "audit.read",
    "step_up.reauth",
  ]),
  maintenance: new Set<Capability>(["step_up.reauth"]),
  inventory: new Set<Capability>(["step_up.reauth"]),
  logistics: new Set<Capability>(["step_up.reauth"]),
  auditor: new Set<Capability>(["audit.read", "audit_log.read"]),
  support: new Set<Capability>([]),
};

export function can(role: Role, capability: Capability): boolean {
  return matrix[role].has(capability);
}

export function requireAny(role: Role, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

/**
 * MOD-01 §6.7: "A user may never grant a role or scope broader than their
 * own delegated authority." An `org_admin` cannot grant `owner`. An
 * `org_admin` cannot grant `org_admin` to a user who does not already
 * have it (the caller is the only one with that role assignment).
 */
const roleRank: Record<Role, number> = {
  owner: 100,
  org_admin: 80,
  seller: 60,
  farm_manager: 60,
  supervisor: 50,
  veterinarian: 50,
  biosecurity_qa: 50,
  maintenance: 40,
  inventory: 40,
  logistics: 40,
  caretaker: 30,
  auditor: 20,
  support: 10,
};

/**
 * Exported so the access-control feature can render a visual rank ladder
 * that matches the grant-check rule used by `canGrantRole()`. The single
 * source of truth remains this module.
 */
export function getRoleRank(role: Role): number {
  return roleRank[role];
}

export function canGrantRole(actor: Role, target: Role): boolean {
  if (!can(actor, "membership.role.change")) return false;
  return roleRank[target] <= roleRank[actor];
}

export function highestGrantableRole(actor: Role): Role {
  const eligible = (Object.keys(roleRank) as Role[]).filter((r) => canGrantRole(actor, r));
  eligible.sort((a, b) => roleRank[a] - roleRank[b]);
  return eligible[eligible.length - 1] ?? "support";
}

/**
 * Roles that organization owners are allowed to edit on the Roles &
 * Permissions page. `owner` is intentionally excluded: an owner can never
 * be partially locked out of their own privileges (changing their own
 * capability set would be irreversible by design -- the only path back is
 * a second owner acting). This list is the **single source of truth** for
 * both the UI affordances and the Server Action gates.
 */
export const EDITABLE_ROLES: readonly Role[] = ROLES.filter(
  (r): r is Role => r !== "owner",
);

/**
 * Capabilities that are structurally non-overridable for any role. The
 * owner is never editable at all (see EDITABLE_ROLES). On top of that,
 * `step_up.reauth` is preserved on every role that has it by default --
 * removing it would break every sensitive Server Action the role can
 * perform (the reauth gate fails closed). The list is kept tiny on
 * purpose: anything not listed here follows the canonical matrix and is
 * fully overridable by an owner.
 */
const NON_OVERRIDABLE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "step_up.reauth",
]);

export function isCapabilityOverridable(capability: Capability): boolean {
  return !NON_OVERRIDABLE_CAPABILITIES.has(capability);
}

export function isRoleEditable(role: Role): boolean {
  return EDITABLE_ROLES.includes(role);
}

/**
 * Database-backed capability resolution. Reads per-org overrides from
 * `role_capability_overrides` via the `effective_capabilities` helper and
 * merges them on top of the canonical matrix in this module.
 *
 * The shape mirrors the RLS-locked helper: a JSON object keyed by role
 * where each value is an object keyed by capability mapping to boolean.
 * The owner role is always reported as the canonical matrix (it cannot
 * be overridden), regardless of any stray rows in the table (which would
 * also be rejected by the row-level CHECK on `role <> 'owner'`).
 */
export type ResolvedCapabilities = Readonly<Record<Role, Readonly<Record<Capability, boolean>>>>;

export type CapabilitiesByRole = Readonly<Record<Role, ReadonlySet<Capability>>>;

export function buildDefaultCapabilities(): CapabilitiesByRole {
  const out = {} as Record<Role, ReadonlySet<Capability>>;
  for (const r of ROLES) {
    const set = new Set<Capability>();
    for (const c of CAPABILITIES) {
      if (matrix[r].has(c)) set.add(c);
    }
    out[r] = set;
  }
  return out;
}

// NOTE: The async, DB-backed capability resolvers (`resolveCapabilitiesForOrg`,
// `canForOrg`) live in `./permissions.server.ts`. They cannot live here
// because this module is imported by client components (e.g. ROLES is used
// in selects), and importing `@/lib/supabase/server` from a module that ends
// up in the client bundle is rejected by Next/Turbopack.

function mergeOverrides(
  overrides: Partial<Record<Role, Partial<Record<Capability, boolean>>>>,
): ResolvedCapabilities {
  const merged = {} as Record<Role, Record<Capability, boolean>>;
  for (const r of ROLES) {
    const baseSet = matrix[r];
    const roleOverrides = overrides[r] ?? {};
    merged[r] = {} as Record<Capability, boolean>;
    for (const c of CAPABILITIES) {
      const hasOverride = Object.prototype.hasOwnProperty.call(roleOverrides, c);
      if (hasOverride && isCapabilityOverridable(c) && isRoleEditable(r)) {
        merged[r][c] = Boolean(roleOverrides[c]);
      } else {
        merged[r][c] = baseSet.has(c);
      }
    }
  }
  return merged;
}

function buildCanonicalResolved(): ResolvedCapabilities {
  const merged = {} as Record<Role, Record<Capability, boolean>>;
  for (const r of ROLES) {
    merged[r] = {} as Record<Capability, boolean>;
    for (const c of CAPABILITIES) {
      merged[r][c] = matrix[r].has(c);
    }
  }
  return merged;
}

// `resolveCapabilitiesForOrg` / `canForOrg` are exported from
// `./permissions.server.ts` instead.
