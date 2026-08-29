import { describe, expect, it } from "vitest";
import { can, ROLES, type Role } from "./permissions";
import {
  ADMIN_CAPABILITIES,
  DEFAULT_ROLE_GRANTS,
  PAGE_ACTIONS,
  RESOURCES,
  SYSTEM_ROLES,
  grantKey,
} from "./rbac";

// Maps each page a role can open today to the old checks that granted it.
// This test is the no-regression gate: seeded grants == today's access.
const LEGACY_PAGE_ACCESS: Record<string, readonly Role[]> = {
  dashboard: ["owner", "org_admin"],
  products: ["owner", "org_admin", "seller", "supervisor"],
  orders: ["owner", "org_admin", "seller", "supervisor"],
  customers: ["owner", "org_admin", "seller", "supervisor"],
  market_prices: ["owner", "org_admin", "seller", "supervisor"],
  dispatch: ["owner", "org_admin", "seller", "supervisor"],
  delivery_runs: ["owner", "org_admin", "seller", "supervisor"],
  delivery_setup: ["owner", "org_admin", "seller", "supervisor"],
  warehouse_tasks: ["owner", "org_admin", "inventory"],
  loading: ["owner", "org_admin", "inventory"],
  driver_deck: ["owner", "org_admin", "driver"],
  leave: [...ROLES],
  leave_management: ["owner", "org_admin", "hr"],
  users: ["owner", "org_admin"],
  roles: ["owner", "org_admin"],
  data_console: ["org_admin"],
  settings: ["owner", "org_admin"],
};

describe("DEFAULT_ROLE_GRANTS parity with legacy access", () => {
  it("covers every resource", () => {
    expect(Object.keys(LEGACY_PAGE_ACCESS).sort()).toEqual([...RESOURCES].sort());
  });

  for (const resource of Object.keys(LEGACY_PAGE_ACCESS)) {
    for (const { key: role } of SYSTEM_ROLES) {
      it(`${role} view on ${resource} matches legacy`, () => {
        const legacy = (LEGACY_PAGE_ACCESS[resource] ?? []).includes(role as Role);
        const seeded = DEFAULT_ROLE_GRANTS[role].has(grantKey(resource, "view"));
        expect(seeded).toBe(legacy);
      });
    }
  }

  it("carries over legacy admin capabilities", () => {
    for (const cap of ADMIN_CAPABILITIES) {
      if (cap === "orders.reopen" || cap === "data_console.manage") continue;
      for (const { key: role } of SYSTEM_ROLES) {
        const seeded = DEFAULT_ROLE_GRANTS[role].has(grantKey(cap, "use"));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(seeded, `${role}/${cap}`).toBe(can(role as Role, cap as any));
      }
    }
    // New capabilities preserve today's inline owner/org_admin checks:
    expect(DEFAULT_ROLE_GRANTS.owner.has(grantKey("orders.reopen", "use"))).toBe(true);
    expect(DEFAULT_ROLE_GRANTS.org_admin.has(grantKey("orders.reopen", "use"))).toBe(true);
    expect(DEFAULT_ROLE_GRANTS.owner.has(grantKey("data_console.manage", "use"))).toBe(false);
    expect(DEFAULT_ROLE_GRANTS.org_admin.has(grantKey("data_console.manage", "use"))).toBe(true);
  });

  it("add/edit/delete imply view", () => {
    for (const { key: role } of SYSTEM_ROLES) {
      for (const resource of RESOURCES) {
        for (const action of ["add", "edit", "delete"] as const) {
          if (DEFAULT_ROLE_GRANTS[role].has(grantKey(resource, action))) {
            // Known exception: seller/supervisor hold loading:edit RPC-only.
            if (resource === "loading" && (role === "seller" || role === "supervisor")) continue;
            expect(
              DEFAULT_ROLE_GRANTS[role].has(grantKey(resource, "view")),
              `${role} ${resource}:${action} without view`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
