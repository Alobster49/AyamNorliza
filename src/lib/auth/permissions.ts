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
  "hr",
  "seller",
  "supervisor",
  "driver",
  "inventory",
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
  // Admin ("org_admin" is the stored value; the UI label is "Admin") has
  // full access — every capability, same as owner. The only screen that
  // separates them is the data console, which is admin-only by page/action
  // gate, not by capability.
  org_admin: new Set<Capability>(CAPABILITIES),
  // HR holds none of the MOD-01 capabilities above -- its authority lives in
  // the separate leave domain (LEAVE_APPROVER_ROLES in
  // src/features/hr/lib/roles.ts), which this matrix does not model.
  hr: new Set<Capability>(["step_up.reauth"]),
  seller: new Set<Capability>([
    "catalog.manage",
    "orders.manage",
    "customers.manage",
    "step_up.reauth",
  ]),
  // Supervisor mirrors seller exactly (same pages, same actions); the SQL
  // side mirrors this via the supervisor→seller alias in has_org_role.
  supervisor: new Set<Capability>([
    "catalog.manage",
    "orders.manage",
    "customers.manage",
    "step_up.reauth",
  ]),
  // A driver only ever works one run at a time on a phone. Everything they
  // may read is scoped by RLS to the run they are assigned to, so they hold
  // no org-wide capability at all.
  driver: new Set<Capability>([]),
  // Worker ("inventory" is the stored value; the UI label is "Worker"):
  // warehouse tasks + loading only.
  inventory: new Set<Capability>(["step_up.reauth"]),
};

export function can(role: Role, capability: Capability): boolean {
  return matrix[role].has(capability);
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
  hr: 75,
  seller: 60,
  supervisor: 60,
  inventory: 40,
  driver: 30,
};

/**
 * Exported so the access-control feature can render a visual rank ladder
 * that matches the grant-check rule used by `canGrantRole()`. The single
 * source of truth remains this module.
 */
export function getRoleRank(role: Role): number {
  return roleRank[role];
}

/**
 * Dynamic-RBAC rank check (see `src/lib/auth/require-permission.ts`):
 * `organization_roles.rank` replaces the hardcoded `roleRank` table above as
 * the source of truth once a caller has real rows to compare, so this is
 * kept pure and numeric rather than keyed by the legacy `Role` union.
 * `actorCanChangeRoles` is the caller's `membership.role.change` capability,
 * resolved via `actorCan()` by the caller (this function stays DB-free).
 */
export function canGrantRole(
  actorRank: number,
  targetRank: number,
  actorCanChangeRoles: boolean,
): boolean {
  return actorCanChangeRoles && targetRank <= actorRank;
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
