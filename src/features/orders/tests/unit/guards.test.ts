/**
 * Unit tests for `requireOrgRole`. The Supabase server client is mocked, so
 * these assert the *query* the guard sends rather than a database verdict:
 * whether a membership row is filtered out by an expiry is something only
 * Postgres can decide, so the thing worth pinning here is that the guard
 * asks for the same window the RLS policies use.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderPermissionError } from "../../server/guards";
import { requireOrgRole } from "../../server/guards";

type QueryResult = { data: unknown; error: { message: string } | null };
type Builder = Record<string, ReturnType<typeof vi.fn>>;

const builders = new Map<string, Builder>();

function chain(result: QueryResult): Builder {
  const builder = {} as Builder;
  for (const method of ["select", "eq", "or", "is", "in", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return builder;
}

function mockSupabaseFor({
  userId = "user-1" as string | null,
  orgId = "org-1" as string | null,
  role = "seller" as string | null,
} = {}) {
  builders.clear();
  const results: Record<string, QueryResult> = {
    organizations: {
      data: orgId ? { id: orgId, default_time_zone: "Asia/Kuala_Lumpur" } : null,
      error: null,
    },
    organization_members: { data: role ? { role } : null, error: null },
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      const builder = builders.get(table) ?? chain(results[table] ?? { data: null, error: null });
      builders.set(table, builder);
      return builder;
    }),
  } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

describe("requireOrgRole", () => {
  it("returns the org context for a member holding one of the roles", async () => {
    mockSupabaseFor({ role: "seller" });

    await expect(requireOrgRole("acme", ["seller", "owner"])).resolves.toMatchObject({
      orgId: "org-1",
      userId: "user-1",
      role: "seller",
    });
  });

  it("rejects a member whose role is not in the allow-list", async () => {
    mockSupabaseFor({ role: "driver" });

    await expect(requireOrgRole("acme", ["seller"])).rejects.toBeInstanceOf(OrderPermissionError);
  });

  it("excludes memberships whose temporary access has already expired", async () => {
    mockSupabaseFor({ role: "seller" });

    await requireOrgRole("acme", ["seller"]);

    const orFilters = builders.get("organization_members")?.or?.mock.calls.map((c) => c[0]) ?? [];
    expect(orFilters.some((f: string) => /expires_at\.is\.null.*expires_at\.gt\./.test(f))).toBe(
      true,
    );
  });
});
