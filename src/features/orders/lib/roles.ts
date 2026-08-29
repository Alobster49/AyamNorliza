/**
 * Client-safe role lists for the order pipeline. These mirror the role
 * arrays the SQL RPCs enforce with `has_org_role(org, array[...])` — see
 * `server/guards.ts` for the server-side check and the SQL migrations for
 * the RPC-side enforcement.
 */

/** Full admin pair: owner + admin (stored value "org_admin"). */
export const ADMIN_ROLES = ["owner", "org_admin"] as const;
/** Sales-side roles: products, orders, customers, market prices, dispatch, runs, delivery setup. */
export const MANAGER_ROLES = [...ADMIN_ROLES, "seller", "supervisor"] as const;
/** Warehouse-side roles: warehouse tasks + loading. "inventory" is the stored value for Worker. */
export const WAREHOUSE_ROLES = [...ADMIN_ROLES, "inventory"] as const;
export const STAFF_ROLES = [...MANAGER_ROLES, "inventory"] as const;
/**
 * Who may open the driver deck and record at a stop. The office is included
 * so a drop phoned in by a driver with a flat phone can still be recorded --
 * the SQL side (can_record_stop) allows exactly the same set.
 */
export const DRIVER_AND_MANAGER_ROLES = [...ADMIN_ROLES, "driver"] as const;
export type OrgRole = string;
