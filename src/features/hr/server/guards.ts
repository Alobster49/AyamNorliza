/**
 * Org-role guards for the HR leave Server Actions — thin wrappers over the
 * shared `requireOrgRole` (order-pipeline guards.ts) with the Task 3 role
 * constants. Kept separate from that module (rather than inlining the role
 * arrays at each call site) so `LEAVE_APPROVER_ROLES`/`ALL_MEMBER_ROLES`
 * stay the single source of truth for "who can do what" in this feature.
 */

import "server-only";

import {
  requireOrgRole,
  OrderPermissionError,
  type OrgRoleContext,
} from "@/features/orders/server/guards";
import { LEAVE_APPROVER_ROLES, ALL_MEMBER_ROLES } from "../lib/roles";

export { OrderPermissionError, type OrgRoleContext };

/** owner/org_admin/hr — may read the approval queue and decide requests. */
export async function requireLeaveApprover(organizationSlug: string): Promise<OrgRoleContext> {
  return requireOrgRole(organizationSlug, LEAVE_APPROVER_ROLES);
}

/** Any active member — everyone may open My Leave, drivers included. */
export async function requireMember(organizationSlug: string): Promise<OrgRoleContext> {
  return requireOrgRole(organizationSlug, ALL_MEMBER_ROLES);
}
