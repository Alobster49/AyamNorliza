/**
 * Client-safe role lists for the logistics feature. Mirror the role arrays
 * the SQL RPCs enforce with `has_org_role` (see the 20260814000001
 * migration): dispatch actions allow logistics staff; facility edits are
 * owner/org_admin only.
 */

export const FACILITY_ADMIN_ROLES = ["owner", "org_admin"] as const;
export const DISPATCH_ROLES = ["owner", "org_admin", "seller", "logistics"] as const;
