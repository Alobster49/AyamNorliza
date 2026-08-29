import { ROLES } from "@/lib/auth/permissions";

/** Roles that may act on leave/credit requests and edit leave settings. */
export const LEAVE_APPROVER_ROLES = ["owner", "org_admin", "hr"] as const;

/** Every org member may open My Leave — drivers included. */
export const ALL_MEMBER_ROLES = ROLES;
