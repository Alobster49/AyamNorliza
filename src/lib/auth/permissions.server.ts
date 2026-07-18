/**
 * Server-only DB-backed capability resolvers.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  type Capability,
  type CapabilitiesByRole,
  type ResolvedCapabilities,
  type Role,
  CAPABILITIES,
  ROLES,
  can,
  isCapabilityOverridable,
  isRoleEditable,
} from "./permissions";

export type { Capability, CapabilitiesByRole, ResolvedCapabilities, Role };

function mergeOverrides(
  overrides: Partial<Record<Role, Partial<Record<Capability, boolean>>>>,
): ResolvedCapabilities {
  const merged = {} as Record<Role, Record<Capability, boolean>>;
  for (const r of ROLES) {
    const roleOverrides = overrides[r] ?? {};
    merged[r] = {} as Record<Capability, boolean>;
    for (const c of CAPABILITIES) {
      const hasOverride = Object.prototype.hasOwnProperty.call(roleOverrides, c);
      if (hasOverride && isCapabilityOverridable(c) && isRoleEditable(r)) {
        merged[r][c] = Boolean(roleOverrides[c]);
      } else {
        merged[r][c] = can(r, c);
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
      merged[r][c] = can(r, c);
    }
  }
  return merged;
}

/**
 * Resolve the effective capability set for an organization by applying
 * per-org overrides on top of the canonical defaults.
 */
export async function resolveCapabilitiesForOrg(
  organizationId: string,
): Promise<ResolvedCapabilities> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("effective_capabilities", {
    p_org: organizationId,
  });
  if (error || !data) {
    return buildCanonicalResolved();
  }
  const overrides = (data ?? {}) as Partial<Record<Role, Partial<Record<Capability, boolean>>>>;
  return mergeOverrides(overrides);
}

/**
 * Convenience async wrapper for a single (organization, role, capability)
 * tuple.
 */
export async function canForOrg(
  organizationId: string,
  role: Role,
  capability: Capability,
): Promise<boolean> {
  if (role === "owner") return true;
  if (!isCapabilityOverridable(capability)) return can(role, capability);
  const resolved = await resolveCapabilitiesForOrg(organizationId);
  return Boolean(resolved[role]?.[capability]);
}