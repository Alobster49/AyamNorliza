/**
 * Client-safe role lists for the order pipeline. These mirror the role
 * arrays the SQL RPCs enforce with `has_org_role(org, array[...])` — see
 * `server/guards.ts` for the server-side check and the SQL migrations for
 * the RPC-side enforcement.
 */

export const MANAGER_ROLES = ["owner", "org_admin", "seller"] as const;
export const STAFF_ROLES = [...MANAGER_ROLES, "inventory", "logistics"] as const;
export type OrgRole = string;
