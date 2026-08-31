/**
 * Unit tests for the roles-editor Server Actions (`../../server/roles.ts`).
 * Follows the pattern in `src/features/orders/tests/unit/order-actions.test.ts`:
 * `@/lib/auth/require-permission` is mocked directly (it's the dynamic-RBAC
 * guard), and the Supabase server client is mocked with a small per-table
 * result queue so each `.from(table)` call in a single action can return a
 * different canned response, in call order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-permission", () => ({
  requirePermission: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OrderPermissionError } from "@/features/orders/server/guards";
import {
  getRolesView,
  createRoleAction,
  renameRoleAction,
  deleteRoleAction,
  setPermissionAction,
  resetRoleToDefaultsAction,
} from "../../server/roles";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "upsert", "eq", "in", "order"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const ORG_ID = "org-1";
const OWNER_ROLE_ID = "11111111-1111-1111-1111-111111111111";
const SYSTEM_ROLE_ID = "22222222-2222-2222-2222-222222222222";
const CUSTOM_ROLE_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_ORG_ROLE_ID = "44444444-4444-4444-4444-444444444444";
const ACTOR_ROLE_ID = "55555555-5555-5555-5555-555555555555";

/**
 * Queues canned results per table; each `.from(table)` call shifts the next
 * queued result (falling back to `{ data: null, error: null }` once drained).
 */
function mockSupabase(queues: Record<string, QueryResult[]>) {
  const from = vi.fn((table: string) => {
    const queue = queues[table];
    const result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
    return chain(result);
  });
  const supabase = { from };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

/** `canEdit === true` grants `('roles','edit')` in addition to whatever `resource`/`action` is being probed. */
function mockPermission(opts: { canView?: boolean; canEdit?: boolean } = {}) {
  const { canView = true, canEdit = true } = opts;
  vi.mocked(requirePermission).mockImplementation(async (_slug, resource, action) => {
    const allowed =
      (resource === "roles" && action === "view" && canView) ||
      (resource === "roles" && action === "edit" && canEdit);
    if (!allowed) throw new OrderPermissionError();
    return { orgId: ORG_ID, userId: "user-1", roleId: ACTOR_ROLE_ID, roleKey: "org_admin", timeZone: "Asia/Kuala_Lumpur" };
  });
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(requirePermission).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getRolesView", () => {
  it("returns roles, grants, canEdit and actorRank for a permitted viewer", async () => {
    mockPermission({ canView: true, canEdit: false });
    mockSupabase({
      organization_roles: [
        {
          data: [
            { id: ACTOR_ROLE_ID, key: "org_admin", name: "Admin", description: null, rank: 80, is_system: true },
            { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          ],
          error: null,
        },
      ],
      organization_members: [
        { data: [{ role_id: CUSTOM_ROLE_ID }], error: null },
      ],
      role_permissions: [
        {
          data: [{ role_id: CUSTOM_ROLE_ID, resource: "orders", action: "view", granted: true }],
          error: null,
        },
      ],
    });

    const view = await getRolesView("acme");

    expect(view.canEdit).toBe(false);
    expect(view.actorRank).toBe(80);
    expect(view.roles).toEqual([
      { id: ACTOR_ROLE_ID, key: "org_admin", name: "Admin", description: null, rank: 80, isSystem: true, memberCount: 0 },
      { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, isSystem: false, memberCount: 1 },
    ]);
    expect(view.grants[CUSTOM_ROLE_ID]).toEqual(["orders:view"]);
    expect(view.grants[ACTOR_ROLE_ID]).toEqual([]);
  });

  it("throws when the caller lacks roles:view", async () => {
    mockPermission({ canView: false });
    mockSupabase({});

    await expect(getRolesView("acme")).rejects.toBeInstanceOf(OrderPermissionError);
  });
});

describe("authorization gate (shared across mutations)", () => {
  it("rejects a non-editor", async () => {
    mockPermission({ canEdit: false });
    mockSupabase({});

    const result = await renameRoleAction({ organizationSlug: "acme", roleId: CUSTOM_ROLE_ID, name: "New name" });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.identity.roles.forbidden",
    });
  });
});

describe("renameRoleAction", () => {
  it("rejects renaming a system role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: SYSTEM_ROLE_ID, key: "seller", name: "Seller", description: null, rank: 60, is_system: true },
          error: null,
        },
      ],
    });

    const result = await renameRoleAction({ organizationSlug: "acme", roleId: SYSTEM_ROLE_ID, name: "New name" });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.identity.roles.systemLocked",
    });
  });

  it("rejects renaming the owner role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: OWNER_ROLE_ID, key: "owner", name: "Owner", description: null, rank: 100, is_system: true },
          error: null,
        },
      ],
    });

    const result = await renameRoleAction({ organizationSlug: "acme", roleId: OWNER_ROLE_ID, name: "New name" });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.identity.roles.ownerLocked",
    });
  });

  it("rejects a roleId belonging to a different org", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [{ data: null, error: null }],
    });

    const result = await renameRoleAction({ organizationSlug: "acme", roleId: OTHER_ORG_ROLE_ID, name: "New name" });

    expect(result).toEqual({
      ok: false,
      code: "not_found",
      message: expect.any(String),
      messageKey: "errors.identity.roles.notFound",
    });
  });

  it("renames a custom role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
        { data: null, error: null },
      ],
    });

    const result = await renameRoleAction({ organizationSlug: "acme", roleId: CUSTOM_ROLE_ID, name: "Renamed" });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe("deleteRoleAction", () => {
  it("rejects deleting a role with active members", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
      ],
      organization_members: [{ data: [{ id: "member-1" }], error: null }],
    });

    const result = await deleteRoleAction({ organizationSlug: "acme", roleId: CUSTOM_ROLE_ID });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: expect.any(String),
      messageKey: "errors.identity.roles.hasMembers",
    });
  });

  it("rejects deleting a system role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: SYSTEM_ROLE_ID, key: "seller", name: "Seller", description: null, rank: 60, is_system: true },
          error: null,
        },
      ],
    });

    const result = await deleteRoleAction({ organizationSlug: "acme", roleId: SYSTEM_ROLE_ID });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.identity.roles.systemLocked",
    });
  });

  it("deletes a custom role with no members", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
        { data: null, error: null },
      ],
      organization_members: [{ data: [], error: null }],
    });

    const result = await deleteRoleAction({ organizationSlug: "acme", roleId: CUSTOM_ROLE_ID });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe("setPermissionAction", () => {
  it("cascades a view-revoke to add/edit/delete", async () => {
    mockPermission();
    const supabase = mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
      ],
      role_permissions: [{ data: null, error: null }],
    });

    const result = await setPermissionAction({
      organizationSlug: "acme",
      roleId: CUSTOM_ROLE_ID,
      resource: "orders",
      action: "view",
      granted: false,
    });

    expect(result).toEqual({ ok: true, data: undefined });
    const upsertCall = supabase.from.mock.results.find(
      (_, i) => supabase.from.mock.calls[i]?.[0] === "role_permissions",
    );
    const upsertBuilder = upsertCall!.value as { upsert: ReturnType<typeof vi.fn> };
    expect(upsertBuilder.upsert).toHaveBeenCalledWith(
      [
        { role_id: CUSTOM_ROLE_ID, resource: "orders", action: "view", granted: false },
        { role_id: CUSTOM_ROLE_ID, resource: "orders", action: "add", granted: false },
        { role_id: CUSTOM_ROLE_ID, resource: "orders", action: "edit", granted: false },
        { role_id: CUSTOM_ROLE_ID, resource: "orders", action: "delete", granted: false },
      ],
      { onConflict: "role_id,resource,action" },
    );
  });

  it("auto-grants view when granting add", async () => {
    mockPermission();
    const supabase = mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
      ],
      role_permissions: [{ data: null, error: null }],
    });

    const result = await setPermissionAction({
      organizationSlug: "acme",
      roleId: CUSTOM_ROLE_ID,
      resource: "orders",
      action: "add",
      granted: true,
    });

    expect(result).toEqual({ ok: true, data: undefined });
    const upsertCall = supabase.from.mock.results.find(
      (_, i) => supabase.from.mock.calls[i]?.[0] === "role_permissions",
    );
    const upsertBuilder = upsertCall!.value as { upsert: ReturnType<typeof vi.fn> };
    expect(upsertBuilder.upsert).toHaveBeenCalledWith(
      [
        { role_id: CUSTOM_ROLE_ID, resource: "orders", action: "view", granted: true },
        { role_id: CUSTOM_ROLE_ID, resource: "orders", action: "add", granted: true },
      ],
      { onConflict: "role_id,resource,action" },
    );
  });

  it("does not cascade a standalone admin capability ('use')", async () => {
    mockPermission();
    const supabase = mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
      ],
      role_permissions: [{ data: null, error: null }],
    });

    await setPermissionAction({
      organizationSlug: "acme",
      roleId: CUSTOM_ROLE_ID,
      resource: "audit.read",
      action: "use",
      granted: true,
    });

    const upsertCall = supabase.from.mock.results.find(
      (_, i) => supabase.from.mock.calls[i]?.[0] === "role_permissions",
    );
    const upsertBuilder = upsertCall!.value as { upsert: ReturnType<typeof vi.fn> };
    expect(upsertBuilder.upsert).toHaveBeenCalledWith(
      [{ role_id: CUSTOM_ROLE_ID, resource: "audit.read", action: "use", granted: true }],
      { onConflict: "role_id,resource,action" },
    );
  });

  it("rejects any grant edit on the owner role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: OWNER_ROLE_ID, key: "owner", name: "Owner", description: null, rank: 100, is_system: true },
          error: null,
        },
      ],
    });

    const result = await setPermissionAction({
      organizationSlug: "acme",
      roleId: OWNER_ROLE_ID,
      resource: "orders",
      action: "view",
      granted: false,
    });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.identity.roles.ownerLocked",
    });
  });

  it("rejects granting data_console.manage to any non-owner role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
      ],
    });

    const result = await setPermissionAction({
      organizationSlug: "acme",
      roleId: CUSTOM_ROLE_ID,
      resource: "data_console.manage",
      action: "use",
      granted: true,
    });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.identity.roles.capabilityLocked",
      messageParams: { capability: "data_console.manage" },
    });
  });

  it("allows a grant edit on a system (non-owner) role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: SYSTEM_ROLE_ID, key: "seller", name: "Seller", description: null, rank: 60, is_system: true },
          error: null,
        },
      ],
      role_permissions: [{ data: null, error: null }],
    });

    const result = await setPermissionAction({
      organizationSlug: "acme",
      roleId: SYSTEM_ROLE_ID,
      resource: "orders",
      action: "edit",
      granted: true,
    });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe("createRoleAction", () => {
  it("slugifies the name into a key", async () => {
    mockPermission();
    const supabase = mockSupabase({
      organization_roles: [
        { data: { rank: 80 }, error: null }, // actor rank lookup
        { data: { id: "new-role-id" }, error: null }, // insert
      ],
    });

    const result = await createRoleAction({ organizationSlug: "acme", name: "Regional Sales!!" });

    expect(result).toEqual({ ok: true, data: { roleId: "new-role-id" } });
    // second organization_roles call is the insert
    const insertBuilder = supabase.from.mock.results[1]!.value as { insert: ReturnType<typeof vi.fn> };
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ key: "regional-sales", name: "Regional Sales!!", is_system: false }),
    );
  });

  it("caps rank at min(actorRank - 1, 10) with a floor of 1", async () => {
    mockPermission();
    const supabase = mockSupabase({
      organization_roles: [
        { data: { rank: 80 }, error: null },
        { data: { id: "new-role-id" }, error: null },
      ],
    });

    await createRoleAction({ organizationSlug: "acme", name: "Sales" });

    const insertBuilder = supabase.from.mock.results[1]!.value as { insert: ReturnType<typeof vi.fn> };
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ rank: 10 }));
  });

  it("rejects a duplicate key with a clean messageKey", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        { data: { rank: 80 }, error: null },
        { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
      ],
    });

    const result = await createRoleAction({ organizationSlug: "acme", name: "Seller" });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: expect.any(String),
      messageKey: "errors.identity.roles.duplicateKey",
      messageParams: { key: "seller" },
    });
  });

  it("rejects an empty/unslugifiable name", async () => {
    mockPermission();
    mockSupabase({});

    const result = await createRoleAction({ organizationSlug: "acme", name: "!!!" });

    expect(result).toEqual({
      ok: false,
      code: "validation",
      message: expect.any(String),
      messageKey: "errors.identity.roles.invalidName",
      fieldErrors: { name: ["errors.identity.roles.invalidName"] },
    });
  });

  it("copies grants from the clone source", async () => {
    mockPermission();
    const supabase = mockSupabase({
      organization_roles: [
        { data: { rank: 80 }, error: null }, // actor rank
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        }, // clone source fetch
        { data: { id: "new-role-id" }, error: null }, // insert
      ],
      role_permissions: [
        { data: [{ resource: "orders", action: "view", granted: true }], error: null }, // clone grants read
        { data: null, error: null }, // apply-clone upsert
      ],
    });

    const result = await createRoleAction({
      organizationSlug: "acme",
      name: "Cloned role",
      cloneFromRoleId: CUSTOM_ROLE_ID,
    });

    expect(result).toEqual({ ok: true, data: { roleId: "new-role-id" } });
    const rolePermissionsCallIndices = supabase.from.mock.calls
      .map((call, i) => (call[0] === "role_permissions" ? i : -1))
      .filter((i) => i >= 0);
    const applyCloneIndex = rolePermissionsCallIndices[1]!;
    const roleGrantsBuilder = supabase.from.mock.results[applyCloneIndex]!.value as {
      upsert: ReturnType<typeof vi.fn>;
    };
    expect(roleGrantsBuilder.upsert).toHaveBeenCalledWith(
      [{ role_id: "new-role-id", resource: "orders", action: "view", granted: true }],
      { onConflict: "role_id,resource,action" },
    );
  });

  it("does not copy data_console.manage when cloning a role that holds it", async () => {
    mockPermission();
    const supabase = mockSupabase({
      organization_roles: [
        { data: { rank: 80 }, error: null }, // actor rank
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        }, // clone source fetch
        { data: { id: "new-role-id" }, error: null }, // insert
      ],
      role_permissions: [
        {
          data: [
            { resource: "orders", action: "view", granted: true },
            { resource: "data_console.manage", action: "use", granted: true },
          ],
          error: null,
        }, // clone grants read
        { data: null, error: null }, // apply-clone upsert
      ],
    });

    const result = await createRoleAction({
      organizationSlug: "acme",
      name: "Cloned role",
      cloneFromRoleId: CUSTOM_ROLE_ID,
    });

    expect(result).toEqual({ ok: true, data: { roleId: "new-role-id" } });
    const rolePermissionsCallIndices = supabase.from.mock.calls
      .map((call, i) => (call[0] === "role_permissions" ? i : -1))
      .filter((i) => i >= 0);
    const applyCloneIndex = rolePermissionsCallIndices[1]!;
    const roleGrantsBuilder = supabase.from.mock.results[applyCloneIndex]!.value as {
      upsert: ReturnType<typeof vi.fn>;
    };
    expect(roleGrantsBuilder.upsert).toHaveBeenCalledWith(
      [{ role_id: "new-role-id", resource: "orders", action: "view", granted: true }],
      { onConflict: "role_id,resource,action" },
    );
  });

  it("rejects a clone source belonging to a different org", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        { data: { rank: 80 }, error: null },
        { data: null, error: null }, // clone source not found in this org
      ],
    });

    const result = await createRoleAction({
      organizationSlug: "acme",
      name: "Cloned role",
      cloneFromRoleId: OTHER_ORG_ROLE_ID,
    });

    expect(result).toEqual({
      ok: false,
      code: "not_found",
      message: expect.any(String),
      messageKey: "errors.identity.roles.cloneSourceNotFound",
    });
  });
});

describe("resetRoleToDefaultsAction", () => {
  it("rejects resetting the owner role", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: OWNER_ROLE_ID, key: "owner", name: "Owner", description: null, rank: 100, is_system: true },
          error: null,
        },
      ],
    });

    const result = await resetRoleToDefaultsAction({ organizationSlug: "acme", roleId: OWNER_ROLE_ID });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: expect.any(String),
      messageKey: "errors.identity.roles.ownerLocked",
    });
  });

  it("rejects a custom role (no defaults defined)", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: CUSTOM_ROLE_ID, key: "custom-1", name: "Custom", description: null, rank: 5, is_system: false },
          error: null,
        },
      ],
    });

    const result = await resetRoleToDefaultsAction({ organizationSlug: "acme", roleId: CUSTOM_ROLE_ID });

    expect(result).toEqual({
      ok: false,
      code: "validation",
      message: expect.any(String),
      messageKey: "errors.identity.roles.noDefaults",
    });
  });

  it("resets a system role to DEFAULT_ROLE_GRANTS", async () => {
    mockPermission();
    mockSupabase({
      organization_roles: [
        {
          data: { id: SYSTEM_ROLE_ID, key: "driver", name: "Driver", description: null, rank: 30, is_system: true },
          error: null,
        },
      ],
      role_permissions: [
        { data: null, error: null }, // delete
        { data: null, error: null }, // insert defaults
      ],
    });

    const result = await resetRoleToDefaultsAction({ organizationSlug: "acme", roleId: SYSTEM_ROLE_ID });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});
