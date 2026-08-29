/**
 * Unit tests for schedule-admin Server Actions. The Supabase server client
 * is mocked so no database is required; the dynamic-RBAC `requirePermission`
 * guard (in @/lib/auth/require-permission) is mocked directly — these
 * actions gate on the `delivery_setup` resource.
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
import { OrderPermissionError } from "../../server/guards";
import type { PermissionAction } from "@/lib/auth/rbac";
import { createZone, deleteZone } from "../../server/schedule-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A minimal chainable Supabase query-builder stub. Every builder method
 * (select/insert/update/delete/eq/...) returns the same object so calls
 * can be chained in any order; `.single()`/`.maybeSingle()` resolve the
 * configured result, and the object is itself thenable so code that
 * `await`s the builder directly (no terminal call, e.g. a bare `.delete()`)
 * also resolves the configured result.
 */
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

/**
 * Grants each role holds on `delivery_setup`/`delivery_runs`, mirroring
 * DEFAULT_ROLE_GRANTS in the dynamic-RBAC schema migration: owner/org_admin
 * get full CRUD on both; seller/supervisor get `delivery_setup:view` plus
 * full `delivery_runs` CRUD (the zone/truck/slot/block writes below check
 * `delivery_runs`, not `delivery_setup`, so they still admit sellers); every
 * other role (including a made-up one like "caretaker") gets none.
 */
const GRANTS: Record<string, Partial<Record<string, PermissionAction[]>>> = {
  owner: { delivery_setup: ["view", "add", "edit", "delete"], delivery_runs: ["view", "add", "edit", "delete"] },
  org_admin: { delivery_setup: ["view", "add", "edit", "delete"], delivery_runs: ["view", "add", "edit", "delete"] },
  seller: { delivery_setup: ["view"], delivery_runs: ["view", "add", "edit", "delete"] },
  supervisor: { delivery_setup: ["view"], delivery_runs: ["view", "add", "edit", "delete"] },
};

/**
 * Builds a mock Supabase client and wires the mocked `requirePermission`
 * guard to grant/deny based on `role`; any table name is served from
 * `tableResults`, falling back to `{ data: null, error: null }`.
 */
function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  role = "owner",
  tableResults = {} as Record<string, QueryResult>,
}: {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  tableResults?: Record<string, QueryResult>;
}) {
  vi.mocked(requirePermission).mockImplementation(async (_slug, resource, action) => {
    const grants = (role && GRANTS[role]?.[resource]) || [];
    if (!userId || !orgId || !grants.includes(action)) {
      throw new OrderPermissionError();
    }
    return { orgId, userId, roleId: "role-1", roleKey: role!, timeZone: "Asia/Kuala_Lumpur" };
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (tableResults[table]) {
        return chain(tableResults[table]);
      }
      return chain({ data: null, error: null });
    }),
    rpc: vi.fn(),
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

describe("createZone", () => {
  it("returns forbidden for a non-manager role", async () => {
    mockSupabaseFor({ role: "caretaker" });

    const result = await createZone("ayam-norliza-pilot", { name: "Zone 1" });

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });

  it("rejects invalid input with a validation error", async () => {
    mockSupabaseFor({ role: "owner" });

    const result = await createZone("ayam-norliza-pilot", { name: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
    }
  });

  it("creates a zone on valid input", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        delivery_zones: {
          data: {
            id: "zone-1",
            organization_id: "org-1",
            name: "Zone 1",
            display_order: 0,
            is_active: true,
            created_by: "user-1",
            created_at: "2026-08-10T00:00:00Z",
            updated_at: "2026-08-10T00:00:00Z",
            version: 1,
          },
          error: null,
        },
      },
    });

    const result = await createZone("ayam-norliza-pilot", { name: "Zone 1" });

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: "zone-1", name: "Zone 1" }),
    });
  });
});

describe("deleteZone", () => {
  it("maps a foreign-key violation to a friendly message", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        delivery_zones: {
          data: null,
          error: { code: "23503", message: "update or delete on table violates foreign key constraint" },
        },
      },
    });

    const result = await deleteZone("ayam-norliza-pilot", "zone-1");

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "This zone has orders using it. Remove or reassign those first.",
    });
  });
});
