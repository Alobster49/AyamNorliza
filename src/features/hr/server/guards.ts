/**
 * Guards for the HR leave Server Actions. `requireLeaveApprover` is a thin
 * wrapper over the dynamic-RBAC `requirePermission` (leave_management
 * resource); `requireMember` stays on the shared `requireOrgRole`
 * (order-pipeline guards.ts) with the Task 3 `ALL_MEMBER_ROLES` constant —
 * "any active member" has no dedicated resource of its own to gate on.
 */

import "server-only";

import {
  requireOrgRole,
  OrderPermissionError,
  type OrgRoleContext,
} from "@/features/orders/server/guards";
import { requirePermission, type PermissionContext } from "@/lib/auth/require-permission";
import type { PermissionAction } from "@/lib/auth/rbac";
import { ALL_MEMBER_ROLES } from "../lib/roles";

export { OrderPermissionError, type OrgRoleContext };

/** owner/org_admin/hr — may read the approval queue and decide requests. */
export async function requireLeaveApprover(
  organizationSlug: string,
  action: PermissionAction,
): Promise<PermissionContext> {
  return requirePermission(organizationSlug, "leave_management", action);
}

/** Any active member — everyone may open My Leave, drivers included. */
export async function requireMember(organizationSlug: string): Promise<OrgRoleContext> {
  return requireOrgRole(organizationSlug, ALL_MEMBER_ROLES);
}
