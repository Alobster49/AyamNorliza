import {
  can,
  CAPABILITIES,
  ROLES,
  type Capability,
  type Role,
} from "@/lib/auth/permissions";
import { getRoleRank } from "@/lib/auth/permissions";
import {
  CAPABILITY_GROUPS,
  type CapabilityGroup,
} from "./group-capabilities";

export type MatrixCell = {
  hasCapability: boolean;
};

export type MatrixRow = {
  role: Role;
  rank: number;
  /** Tally of granted capabilities for visual emphasis */
  capabilityCount: number;
  /** Sparse map: capability → cell; every (role, capability) is present. */
  cells: Record<Capability, MatrixCell>;
};

export type CapabilityMatrixData = {
  rows: ReadonlyArray<MatrixRow>;
  groups: ReadonlyArray<CapabilityGroup>;
};

/**
 * Build the editorial heatmap data once per request.
 *
 * Rows are sorted by `roleRank` descending (owner first, support last) so the
 * visual ranks the most-privileged role at the top. Each cell's
 * `hasCapability` is read directly from `can()` — the matrix itself is the
 * single source of truth.
 */
export function buildCapabilityMatrix(): CapabilityMatrixData {
  const sortedRoles = [...ROLES].sort(
    (a, b) => getRoleRank(b) - getRoleRank(a),
  );

  const rows: MatrixRow[] = sortedRoles.map((role) => {
    const cells = {} as Record<Capability, MatrixCell>;
    let capabilityCount = 0;
    for (const cap of CAPABILITIES) {
      const has = can(role, cap);
      cells[cap] = { hasCapability: has };
      if (has) capabilityCount += 1;
    }
    return {
      role,
      rank: getRoleRank(role),
      capabilityCount,
      cells,
    };
  });

  return { rows, groups: CAPABILITY_GROUPS };
}

/**
 * Sort member counts for the role-roster by rank descending (so the
 * highest-privilege roles lead). Pure; consumed by the role-roster server
 * component.
 */
export function buildRoleRoster(
  members: ReadonlyArray<{ role: Role }>,
): Array<{ role: Role; rank: number; count: number }> {
  const tally = new Map<Role, number>();
  for (const m of members) {
    tally.set(m.role, (tally.get(m.role) ?? 0) + 1);
  }
  return [...ROLES]
    .map((role) => ({
      role,
      rank: getRoleRank(role),
      count: tally.get(role) ?? 0,
    }))
    .sort((a, b) => b.rank - a.rank);
}

/**
 * Build the ladder rails: each role projected onto a 0–100 rank scale so the
 * bar heights can be computed without exposing `roleRank` to the renderer.
 */
export function buildRankLadder(): Array<{
  role: Role;
  rank: number;
  pct: number;
}> {
  return [...ROLES]
    .map((role) => {
      const rank = getRoleRank(role);
      return { role, rank, pct: Math.max(rank, 4) };
    })
    .sort((a, b) => b.rank - a.rank);
}
