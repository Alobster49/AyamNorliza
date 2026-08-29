/**
 * Unit tests for the dynamic-RBAC guard layer. The Supabase server client
 * is mocked (same chainable-builder approach as
 * src/features/logistics/tests/unit/dispatch-actions.test.ts) so no
 * database is required. `requirePermissionOrRedirect` mirrors
 * `requireRoleOrRedirect` in @/features/orders/server/guards and has no
 * dedicated test of its own, same as that guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { grantKey } from "./rbac";
import {
  requirePermission,
  requireAnyPermission,
  resolvePermissionsForOrg,
  actorCan,
} from "./require-permission";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "or", "order", "is", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

type RolePermRow = { resource: string; action: string; granted: boolean };

function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  roleId = "role-1",
  roleKey = "seller",
  timeZone = "Asia/Kuala_Lumpur",
  member = true,
  permissions = [] as RolePermRow[],
  tableResults = {} as Record<string, QueryResult>,
}: {
  userId?: string | null;
  orgId?: string | null;
  roleId?: string;
  roleKey?: string;
  timeZone?: string;
  member?: boolean;
  permissions?: RolePermRow[];
  tableResults?: Record<string, QueryResult>;
}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return chain({
          data: orgId ? { id: orgId, default_time_zone: timeZone } : null,
          error: null,
        });
      }
      if (table === "organization_members") {
        return chain({
          data: member
            ? {
                role_id: roleId,
                organization_roles: { key: roleKey, role_permissions: permissions },
              }
            : null,
          error: null,
        });
      }
      if (table === "role_permissions") {
        return chain(tableResults[table] ?? { data: null, error: null });
      }
      if (tableResults[table]) {
        return chain(tableResults[table]);
      }
      return chain({ data: null, error: null });
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("requirePermission", () => {
  it("throws when there is no authenticated user", async () => {
    mockSupabaseFor({ userId: null });
    await expect(requirePermission("acme", "products", "view")).rejects.toThrow(
      OrderPermissionError,
    );
  });

  it("passes and returns roleKey for a member whose role grants the permission", async () => {
    mockSupabaseFor({
      roleKey: "seller",
      permissions: [{ resource: "products", action: "view", granted: true }],
    });

    const ctx = await requirePermission("acme", "products", "view");

    expect(ctx).toEqual({
      orgId: "org-1",
      userId: "user-1",
      roleId: "role-1",
      roleKey: "seller",
      timeZone: "Asia/Kuala_Lumpur",
    });
  });

  it("throws when the member's role does not grant the permission", async () => {
    mockSupabaseFor({
      permissions: [{ resource: "products", action: "view", granted: true }],
    });

    await expect(requirePermission("acme", "orders", "delete")).rejects.toThrow(
      OrderPermissionError,
    );
  });

  it("throws when the grant row exists but is revoked (granted=false)", async () => {
    mockSupabaseFor({
      permissions: [{ resource: "products", action: "view", granted: false }],
    });

    await expect(requirePermission("acme", "products", "view")).rejects.toThrow(
      OrderPermissionError,
    );
  });

  it("throws when the org is not found", async () => {
    mockSupabaseFor({ orgId: null });
    await expect(requirePermission("nope", "products", "view")).rejects.toThrow(
      OrderPermissionError,
    );
  });

  it("throws when the user is not a member of the org", async () => {
    mockSupabaseFor({ member: false });
    await expect(requirePermission("acme", "products", "view")).rejects.toThrow(
      OrderPermissionError,
    );
  });
});

describe("requireAnyPermission", () => {
  it("passes when only the second pair is granted", async () => {
    mockSupabaseFor({
      permissions: [{ resource: "dispatch", action: "edit", granted: true }],
    });

    const ctx = await requireAnyPermission("acme", [
      ["loading", "edit"],
      ["dispatch", "edit"],
    ]);

    expect(ctx.roleKey).toBe("seller");
  });

  it("throws when none of the pairs are granted", async () => {
    mockSupabaseFor({ permissions: [] });

    await expect(
      requireAnyPermission("acme", [
        ["loading", "edit"],
        ["dispatch", "edit"],
      ]),
    ).rejects.toThrow(OrderPermissionError);
  });
});

describe("resolvePermissionsForOrg", () => {
  it("returns null context and an empty grant set when unauthenticated", async () => {
    mockSupabaseFor({ userId: null });

    const { context, grants } = await resolvePermissionsForOrg("acme");

    expect(context).toBeNull();
    expect(grants.size).toBe(0);
  });

  it("returns the full grant set for an authenticated member", async () => {
    mockSupabaseFor({
      permissions: [
        { resource: "products", action: "view", granted: true },
        { resource: "products", action: "edit", granted: false },
        { resource: "orders", action: "add", granted: true },
      ],
    });

    const { context, grants } = await resolvePermissionsForOrg("acme");

    expect(context?.roleKey).toBe("seller");
    expect(grants.has(grantKey("products", "view"))).toBe(true);
    expect(grants.has(grantKey("products", "edit"))).toBe(false);
    expect(grants.has(grantKey("orders", "add"))).toBe(true);
  });
});

describe("actorCan", () => {
  it("returns true when a matching granted row exists", async () => {
    mockSupabaseFor({
      tableResults: {
        role_permissions: { data: { resource: "membership.invite" }, error: null },
      },
    });

    await expect(actorCan("role-1", "membership.invite")).resolves.toBe(true);
  });

  it("returns false when no matching row exists", async () => {
    mockSupabaseFor({
      tableResults: { role_permissions: { data: null, error: null } },
    });

    await expect(actorCan("role-1", "membership.invite")).resolves.toBe(false);
  });
});
