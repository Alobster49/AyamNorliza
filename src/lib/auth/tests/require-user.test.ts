/**
 * Unit tests for `requireUserOrRedirect`'s return-path handling.
 *
 * The behaviour under test: an expired session on `/acme/orders/123` must
 * send the user to `/login?next=/acme/orders/123`, not to the static fallback
 * the layout passes. The real page comes from the `x-pathname` header that
 * `src/proxy.ts` sets.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PATHNAME_HEADER } from "../next-path";
import { requireUserOrRedirect } from "../require-user";

function mockRequest({
  userId = null as string | null,
  pathname = null as string | null,
}) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : { message: "no session" },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);

  vi.mocked(headers).mockResolvedValue({
    get: (name: string) =>
      name === PATHNAME_HEADER ? pathname : null,
  } as unknown as Awaited<ReturnType<typeof headers>>);
}

/** Runs the guard and returns the URL it redirected to. */
async function redirectTarget(fallback?: string): Promise<string> {
  try {
    await requireUserOrRedirect(fallback);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw err;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUserOrRedirect", () => {
  it("returns the user when signed in", async () => {
    mockRequest({ userId: "user-1", pathname: "/acme/orders" });
    await expect(requireUserOrRedirect("/acme")).resolves.toMatchObject({
      id: "user-1",
    });
  });

  it("sends an expired session back to the page it was on, not the fallback", async () => {
    mockRequest({ pathname: "/acme/orders/123" });
    await expect(redirectTarget("/acme")).resolves.toBe(
      "/login?next=%2Facme%2Forders%2F123",
    );
  });

  it("preserves the query string on the requested page", async () => {
    mockRequest({ pathname: "/acme/orders?status=open" });
    await expect(redirectTarget("/acme")).resolves.toBe(
      "/login?next=%2Facme%2Forders%3Fstatus%3Dopen",
    );
  });

  it("falls back to the caller's path when the proxy did not run", async () => {
    mockRequest({ pathname: null });
    await expect(redirectTarget("/acme")).resolves.toBe("/login?next=%2Facme");
  });

  it("ignores a forged header and falls back", async () => {
    mockRequest({ pathname: "//evil.com" });
    await expect(redirectTarget("/acme")).resolves.toBe("/login?next=%2Facme");
  });

  it("redirects to bare /login when there is no usable destination", async () => {
    mockRequest({ pathname: null });
    await expect(redirectTarget()).resolves.toBe("/login");
  });
});
