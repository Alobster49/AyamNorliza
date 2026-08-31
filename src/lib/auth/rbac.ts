/**
 * Canonical dynamic-RBAC model. Mirrors the SQL seed in
 * supabase/migrations/20260901000001_dynamic_rbac_schema.sql — keep the two
 * in sync; rbac.test.ts is the parity gate against the legacy matrix.
 */

export const RESOURCES = [
  "dashboard", "products", "orders", "customers", "market_prices",
  "dispatch", "delivery_runs", "delivery_setup", "warehouse_tasks",
  "loading", "driver_deck", "leave", "leave_management", "users",
  "roles", "data_console", "settings",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const PAGE_ACTIONS = ["view", "add", "edit", "delete"] as const;
export type PageAction = (typeof PAGE_ACTIONS)[number];
export type PermissionAction = PageAction | "use";

export const ADMIN_CAPABILITIES = [
  "organization.manage", "organization.settings.update",
  "membership.invite", "membership.role.change", "membership.scope.change",
  "membership.deactivate", "access_review.run", "access_review.decide",
  "break_glass.open", "break_glass.finalize", "audit.read",
  "audit_log.read", "auth_security.read", "orders.reopen",
  "data_console.manage",
] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export type PermissionKey = `${string}:${PermissionAction}`;
export function grantKey(resource: string, action: PermissionAction): PermissionKey {
  return `${resource}:${action}`;
}

export const SYSTEM_ROLES = [
  { key: "owner", rank: 100 },
  { key: "org_admin", rank: 80 },
  { key: "hr", rank: 75 },
  { key: "seller", rank: 60 },
  { key: "supervisor", rank: 60 },
  { key: "inventory", rank: 40 },
  { key: "driver", rank: 30 },
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLES)[number]["key"];

function crud(resource: Resource): PermissionKey[] {
  return PAGE_ACTIONS.map((a) => grantKey(resource, a));
}
function caps(...list: AdminCapability[]): PermissionKey[] {
  return list.map((c) => grantKey(c, "use"));
}

const SELLER_GRANTS: PermissionKey[] = [
  ...(["products", "orders", "customers", "market_prices", "dispatch", "delivery_runs"] as const)
    .flatMap(crud),
  grantKey("delivery_setup", "view"),
  grantKey("loading", "edit"), // RPC-only (dispatch_set_loaded/claim_loading); page stays hidden
  grantKey("leave", "view"), grantKey("leave", "add"),
];

export const DEFAULT_ROLE_GRANTS: Record<SystemRoleKey, ReadonlySet<PermissionKey>> = {
  owner: new Set([
    ...RESOURCES.filter((r) => r !== "data_console").flatMap(crud),
    ...caps(...ADMIN_CAPABILITIES.filter((c) => c !== "data_console.manage")),
  ]),
  org_admin: new Set([...RESOURCES.flatMap(crud), ...caps(...ADMIN_CAPABILITIES)]),
  hr: new Set([...crud("leave"), ...crud("leave_management")]),
  seller: new Set(SELLER_GRANTS),
  supervisor: new Set(SELLER_GRANTS),
  inventory: new Set([
    grantKey("warehouse_tasks", "view"), grantKey("warehouse_tasks", "edit"),
    grantKey("loading", "view"), grantKey("loading", "edit"),
    grantKey("leave", "view"), grantKey("leave", "add"),
  ]),
  driver: new Set([
    grantKey("driver_deck", "view"), grantKey("driver_deck", "edit"),
    grantKey("leave", "view"), grantKey("leave", "add"),
  ]),
};
