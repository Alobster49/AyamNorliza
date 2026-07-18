import type { Capability } from "@/lib/auth/permissions";

export type CapabilityGroup = {
  /** Stable id used as DOM key + screen-reader label */
  id: string;
  /** Editorial / short label rendered above the column */
  label: string;
  /** Capabilities that belong to this group */
  capabilities: ReadonlyArray<Capability>;
};

/**
 * The 6 buckets used by the editorial capability matrix. Order matters —
 * this drives the visual column order from left to right (Organization,
 * Membership, ...). Listed explicitly so the matrix layout is stable
 * regardless of how `CAPABILITIES` is declared in the future.
 */
export const CAPABILITY_GROUPS: ReadonlyArray<CapabilityGroup> = [
  {
    id: "organization",
    label: "Organization",
    capabilities: ["organization.manage", "organization.settings.update"],
  },
  {
    id: "membership",
    label: "Membership",
    capabilities: [
      "membership.invite",
      "membership.role.change",
      "membership.scope.change",
      "membership.deactivate",
    ],
  },
  {
    id: "access_review",
    label: "Access review",
    capabilities: ["access_review.run", "access_review.decide"],
  },
  {
    id: "support",
    label: "Support",
    capabilities: ["support_session.open", "support_session.end"],
  },
  {
    id: "break_glass",
    label: "Break-glass",
    capabilities: ["break_glass.open", "break_glass.finalize"],
  },
  {
    id: "audit_auth",
    label: "Audit & auth",
    capabilities: [
      "audit.read",
      "audit_log.read",
      "auth_security.read",
      "step_up.reauth",
    ],
  },
];

export function groupCapabilities(
  _all: ReadonlyArray<Capability>,
): ReadonlyArray<CapabilityGroup> {
  // The grouping is fixed in `CAPABILITY_GROUPS` and is the single source of
  // truth for which bucket a capability belongs to. We accept the full list
  // only so callers can pass `CAPABILITIES` and the function stays useful as
  // a stable API.
  return CAPABILITY_GROUPS;
}
