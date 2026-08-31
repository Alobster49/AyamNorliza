import type { AdminCapability } from "@/lib/auth/rbac";

export type AdminCapabilityGroup = {
  /** Stable id, doubles as the `identity.rolesEditor.groups.<id>` message key. */
  id: string;
  capabilities: ReadonlyArray<AdminCapability>;
};

/**
 * Groups `ADMIN_CAPABILITIES` (the dynamic-RBAC standalone "use" grants) for
 * the roles editor's Administration section. Mirrors the buckets in
 * `@/features/access-control/lib/group-capabilities.ts` (same editorial
 * categories) but rebuilt against the current `AdminCapability` union —
 * that file's `Capability` type predates dynamic RBAC and neither has nor
 * needs `orders.reopen` / `data_console.manage`, nor `catalog.manage` (which
 * dynamic RBAC expresses as per-resource CRUD on `products` instead).
 *
 * `identityCoverage.test.ts`-style parity: every entry in `ADMIN_CAPABILITIES`
 * appears in exactly one group here (enforced in `roles-editor` tests).
 */
export const ADMIN_CAPABILITY_GROUPS: ReadonlyArray<AdminCapabilityGroup> = [
  {
    id: "organization",
    capabilities: ["organization.manage", "organization.settings.update", "data_console.manage"],
  },
  {
    id: "membership",
    capabilities: [
      "membership.invite",
      "membership.role.change",
      "membership.scope.change",
      "membership.deactivate",
    ],
  },
  {
    id: "sales",
    capabilities: ["orders.reopen"],
  },
  {
    id: "access_review",
    capabilities: ["access_review.run", "access_review.decide"],
  },
  {
    id: "break_glass",
    capabilities: ["break_glass.open", "break_glass.finalize"],
  },
  {
    id: "audit_auth",
    capabilities: ["audit.read", "audit_log.read", "auth_security.read"],
  },
];

/** Converts a dotted/underscored key (`"access_review.run"`) into the camelCase
 * message-catalog key (`"accessReviewRun"`) used under `identity.rolesEditor.*`. */
export function toMessageKey(key: string): string {
  return key.replace(/[._](\w)/g, (_, c: string) => c.toUpperCase());
}
