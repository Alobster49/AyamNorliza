/**
 * Unit tests for the landing-path resolvers. These lock the contract the
 * bare `/{organizationSlug}` route depends on: no resolver may ever return
 * `/{slug}` itself, or that route would redirect to itself forever.
 *
 * The Supabase server client is mocked with the same chainable-builder idiom
 * as portal-resolve-zone.test.ts, so no database is required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../../server/queries", () => ({
  listOrganizationsForCurrentUser: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOrganizationsForCurrentUser } from "../../server/queries";
import {
  NO_ORGANIZATION_PATH,
  resolveLandingPath,
  resolveLandingPathForSlug,
} from "../../server/landing";

/** Minimal chainable Supabase query-builder stub. */
function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  return builder;
}

function mockSupabase({
  userId = "user-1",
  role = null as string | null,
}: { userId?: string | null; role?: string | null } = {}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn(() => chain({ data: role ? { role } : null, error: null })),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

const ORG = { id: "org-1", slug: "ayam-norliza-pilot" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveLandingPathForSlug", () => {
  it.each(["owner", "org_admin"] as const)(
    "sends %s to the dashboard",
    async (role) => {
      mockSupabase({ role });
      await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
        "/ayam-norliza-pilot/dashboard",
      );
    },
  );

  it("sends sellers to the org catalog", async () => {
    mockSupabase({ role: "seller" });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/products",
    );
  });

  it("sends supervisors to the org catalog too", async () => {
    mockSupabase({ role: "supervisor" });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/products",
    );
  });

  it("sends warehouse workers to the warehouse queue", async () => {
    mockSupabase({ role: "inventory" });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/tasks",
    );
  });

  it("sends hr to the leave approval queue", async () => {
    mockSupabase({ role: "hr" });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/leave/manage",
    );
  });

  it("sends drivers to the driver deck", async () => {
    mockSupabase({ role: "driver" });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/drive/ayam-norliza-pilot",
    );
  });

  it("sends any other active role to a page every member can open", async () => {
    mockSupabase({ role: "buyer" });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBe(
      "/ayam-norliza-pilot/settings/organization",
    );
  });

  it("returns null when the caller is not an active member", async () => {
    mockSupabase({ role: null });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBeNull();
  });

  it("returns null when there is no signed-in user", async () => {
    mockSupabase({ userId: null });
    await expect(resolveLandingPathForSlug(ORG.id, ORG.slug)).resolves.toBeNull();
  });

  it("never returns the bare org path, which would loop", async () => {
    for (const role of ["owner", "org_admin", "seller", "supervisor", "inventory", "hr", "driver", "buyer"]) {
      mockSupabase({ role });
      const path = await resolveLandingPathForSlug(ORG.id, ORG.slug);
      expect(path).not.toBe(`/${ORG.slug}`);
    }
  });
});

describe("resolveLandingPath", () => {
  it("falls back to signup when the user belongs to no organization", async () => {
    mockSupabase();
    vi.mocked(listOrganizationsForCurrentUser).mockResolvedValue([]);
    await expect(resolveLandingPath()).resolves.toBe(NO_ORGANIZATION_PATH);
  });

  it("resolves the first organization by role", async () => {
    mockSupabase({ role: "owner" });
    vi.mocked(listOrganizationsForCurrentUser).mockResolvedValue([
      ORG as never,
    ]);
    await expect(resolveLandingPath()).resolves.toBe(
      "/ayam-norliza-pilot/dashboard",
    );
  });

  it("keeps a membership-less but visible org on settings, not the bare path", async () => {
    mockSupabase({ role: null });
    vi.mocked(listOrganizationsForCurrentUser).mockResolvedValue([
      ORG as never,
    ]);
    await expect(resolveLandingPath()).resolves.toBe(
      "/ayam-norliza-pilot/settings/organization",
    );
  });
});
