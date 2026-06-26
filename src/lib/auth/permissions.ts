/**
 * Capability-based permission helpers.
 *
 * Roles are managed collections of capabilities. A role never widens the
 * caller's own delegated authority (see MOD-01 §6.7).
 *
 * This module is pure (no DB calls). The matrix is the single source of
 * truth for which role may perform which action. Server Actions check
 * `can(role, capability)` before mutating, and RLS independently enforces
 * the same matrix in the database.
 */

export const ROLES = [
  "owner",
  "org_admin",
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
  "farm_structure.manage",
  "master_data.manage",
  "target_profile.manage",
  "target_profile.approve",
  "label.manage",
  "flock_lifecycle.manage",
  "flock_lifecycle.approve",
  "flock_lifecycle.record",
  "flock_lifecycle.close",
  "daily_operations.configure",
  "daily_operations.record",
  "daily_operations.review",
  "daily_operations.close",
  "daily_operations.correct",
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
    "farm_structure.manage",
    "master_data.manage",
    "target_profile.manage",
    "target_profile.approve",
    "label.manage",
    "flock_lifecycle.manage",
    "flock_lifecycle.approve",
    "flock_lifecycle.record",
    "flock_lifecycle.close",
    "daily_operations.configure",
    "daily_operations.record",
    "daily_operations.review",
    "daily_operations.close",
    "daily_operations.correct",
  ]),
  farm_manager: new Set<Capability>([
    "membership.invite",
    "membership.scope.change",
    "access_review.run",
    "audit.read",
    "step_up.reauth",
    "farm_structure.manage",
    "master_data.manage",
    "target_profile.manage",
    "target_profile.approve",
    "label.manage",
    "flock_lifecycle.manage",
    "flock_lifecycle.approve",
    "flock_lifecycle.record",
    "flock_lifecycle.close",
    "daily_operations.configure",
    "daily_operations.record",
    "daily_operations.review",
    "daily_operations.close",
    "daily_operations.correct",
  ]),
  supervisor: new Set<Capability>([
    "audit.read",
    "step_up.reauth",
    "flock_lifecycle.record",
    "daily_operations.record",
    "daily_operations.review",
    "daily_operations.correct",
  ]),
  caretaker: new Set<Capability>(["flock_lifecycle.record", "daily_operations.record"]),
  veterinarian: new Set<Capability>([
    "step_up.reauth",
    "target_profile.manage",
    "target_profile.approve",
    "flock_lifecycle.approve",
    "flock_lifecycle.record",
    "daily_operations.record",
    "daily_operations.review",
  ]),
  biosecurity_qa: new Set<Capability>([
    "audit.read",
    "step_up.reauth",
    "farm_structure.manage",
    "target_profile.manage",
    "target_profile.approve",
    "flock_lifecycle.approve",
    "flock_lifecycle.record",
    "daily_operations.record",
    "daily_operations.review",
    "daily_operations.correct",
  ]),
  maintenance: new Set<Capability>(["step_up.reauth", "label.manage", "daily_operations.record"]),
  inventory: new Set<Capability>(["step_up.reauth", "farm_structure.manage", "label.manage"]),
  logistics: new Set<Capability>(["step_up.reauth", "label.manage", "flock_lifecycle.record"]),
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

export function canGrantRole(actor: Role, target: Role): boolean {
  if (!can(actor, "membership.role.change")) return false;
  return roleRank[target] <= roleRank[actor];
}

export function highestGrantableRole(actor: Role): Role {
  const eligible = (Object.keys(roleRank) as Role[]).filter((r) => canGrantRole(actor, r));
  eligible.sort((a, b) => roleRank[a] - roleRank[b]);
  return eligible[eligible.length - 1] ?? "support";
}
