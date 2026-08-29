/**
 * Client-safe role list still referenced outside the order-pipeline Server
 * Actions (`@/features/identity-access/server/landing.ts`'s post-login
 * routing, which decides a *destination path* by role rather than gating a
 * permission and so has no dynamic-RBAC resource of its own). Every
 * permission-gated role array that used to live here (MANAGER_ROLES,
 * STAFF_ROLES, WAREHOUSE_ROLES, DRIVER_AND_MANAGER_ROLES) was retired in the
 * Task 6 server-action sweep — those call sites now check
 * `requirePermission`/`requireAnyPermission` grants instead.
 */

/** Full admin pair: owner + admin (stored value "org_admin"). */
export const ADMIN_ROLES = ["owner", "org_admin"] as const;
