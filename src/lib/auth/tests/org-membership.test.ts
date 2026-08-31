/**
 * `requireOrgMember` / `isActiveOrgMember` used to demand `expires_at IS
 * NULL`, which denied a temporary member who still had days left on their
 * grant. These pin the corrected window — the same one the RLS policies
 * use — by inspecting the query the guard sends, since whether a given row
 * survives the filter is Postgres's decision, not the client's.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isActiveOrgMember, requireOrgMember } from "../require-user";

type Builder = Record<string, ReturnType<typeof vi.fn>>;

const builders = new Map<string, Builder>();

function chain(data: unknown): Builder {
  const builder = {} as Builder;
  for (const method of ["select", "eq", "or", "is", "in", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve({ data, error: null }));
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  return builder;
}

function mockMembership(row: unknown) {
  builders.clear();
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: vi.fn((table: string) => {
      const builder = builders.get(table) ?? chain(row);
      builders.set(table, builder);
      return builder;
    }),
  } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
}

/** Every filter passed to `.or()` on the membership query. */
function membershipOrFilters(): string[] {
  return (builders.get("organization_members")?.or?.mock.calls.map((c) => c[0]) ?? []) as string[];
}

const LIVE_WINDOW = /expires_at\.is\.null.*expires_at\.gt\./;

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

describe("requireOrgMember", () => {
  it("admits a member whose temporary access has not run out yet", async () => {
    mockMembership({ id: "m-1", role: "seller", expires_at: "2099-01-01T00:00:00Z" });

    await requireOrgMember("org-1");

    expect(membershipOrFilters().some((f) => LIVE_WINDOW.test(f))).toBe(true);
    // The old `.is("expires_at", null)` would have excluded this member.
    expect(builders.get("organization_members")?.is).not.toHaveBeenCalledWith(
      "expires_at",
      null,
    );
  });
});

describe("isActiveOrgMember", () => {
  it("uses the same window as requireOrgMember", async () => {
    mockMembership({ id: "m-1" });

    await isActiveOrgMember("org-1");

    expect(membershipOrFilters().some((f) => LIVE_WINDOW.test(f))).toBe(true);
    expect(builders.get("organization_members")?.is).not.toHaveBeenCalledWith(
      "expires_at",
      null,
    );
  });
});
