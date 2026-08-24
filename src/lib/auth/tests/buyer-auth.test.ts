/**
 * Unit tests for `requireBuyerOrRedirect`.
 *
 * The behaviour under test: an unauthenticated buyer must land on the
 * locale-prefixed portal login page - `/en/buyer_portal/{slug}/login` - and
 * not on `/{slug}/login`, which is not a route and used to render a 404.
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
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn().mockResolvedValue("en"),
}));

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PATHNAME_HEADER } from "../next-path";
import { requireBuyerOrRedirect } from "../buyer-auth";

const SLUG = "ayam-norliza-pilot";

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  return builder;
}

function mockRequest({
  userId = null as string | null,
  buyerId = null as string | null,
  pathname = null as string | null,
}) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : { message: "no session" },
      }),
    },
    from: vi.fn(() =>
      chain({
        data: buyerId ? { id: buyerId, organization_id: "org-1" } : null,
        error: buyerId ? null : { message: "not found" },
      }),
    ),
  } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);

  vi.mocked(headers).mockResolvedValue({
    get: (name: string) => (name === PATHNAME_HEADER ? pathname : null),
  } as unknown as Awaited<ReturnType<typeof headers>>);
}

async function redirectTarget(): Promise<string> {
  try {
    await requireBuyerOrRedirect(SLUG);
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

describe("requireBuyerOrRedirect", () => {
  it("returns the buyer when signed in", async () => {
    mockRequest({ userId: "user-1", buyerId: "user-1" });
    await expect(requireBuyerOrRedirect(SLUG)).resolves.toMatchObject({
      id: "user-1",
    });
  });

  it("redirects to the portal login page, not the non-existent /{slug}/login", async () => {
    mockRequest({ pathname: null });
    const target = await redirectTarget();
    expect(target).toBe(`/en/buyer_portal/${SLUG}/login`);
    expect(target).not.toBe(`/${SLUG}/login`);
  });

  it("carries the page the buyer was on", async () => {
    mockRequest({ pathname: `/buyer_portal/${SLUG}/orders/order-9` });
    await expect(redirectTarget()).resolves.toBe(
      `/en/buyer_portal/${SLUG}/login?next=%2Fbuyer_portal%2F${SLUG}%2Forders%2Forder-9`,
    );
  });

  it("carries the page the buyer was on even when the header is locale-prefixed", async () => {
    // The real `x-pathname` header always carries the locale prefix
    // `src/middleware.ts` sees on the request (e.g. "/ms/buyer_portal/..."),
    // while `buyerPortalPrefix` never does - `buyerReturnPath` must strip it
    // before comparing, or every request is rejected and `next` is always
    // dropped.
    mockRequest({ pathname: `/ms/buyer_portal/${SLUG}/orders/order-9` });
    await expect(redirectTarget()).resolves.toBe(
      `/en/buyer_portal/${SLUG}/login?next=%2Fbuyer_portal%2F${SLUG}%2Forders%2Forder-9`,
    );
  });

  it("redirects a signed-in non-buyer to the portal login too", async () => {
    mockRequest({ userId: "user-1", buyerId: null, pathname: null });
    await expect(redirectTarget()).resolves.toBe(
      `/en/buyer_portal/${SLUG}/login`,
    );
  });

  it("refuses a return path from another organization's portal", async () => {
    mockRequest({ pathname: "/buyer_portal/other-org/orders" });
    await expect(redirectTarget()).resolves.toBe(
      `/en/buyer_portal/${SLUG}/login`,
    );
  });

  it("refuses a return path outside the buyer portal", async () => {
    mockRequest({ pathname: `/${SLUG}/settings/users` });
    await expect(redirectTarget()).resolves.toBe(
      `/en/buyer_portal/${SLUG}/login`,
    );
  });

  it("does not return the buyer to the login page itself", async () => {
    mockRequest({ pathname: `/buyer_portal/${SLUG}/login` });
    await expect(redirectTarget()).resolves.toBe(
      `/en/buyer_portal/${SLUG}/login`,
    );
  });
});
