/**
 * Unit tests for `loginAction`, focused on the cross-device locale sync
 * added on top of the sign-in path: a successful `signInWithPassword` must
 * trigger `syncLocaleCookieFromAccount()`, a failed one must not, and a
 * throwing sync must never turn a successful sign-in into a failure.
 *
 * Mock idiom copied from `landing.test.ts` / `buyer-auth/tests/unit/auth-actions.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../../server/landing", () => ({
  resolveLandingPath: vi.fn(),
}));

vi.mock("@/lib/i18n/actions", () => ({
  syncLocaleCookieFromAccount: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "../../server/landing";
import { syncLocaleCookieFromAccount } from "@/lib/i18n/actions";
import { loginAction } from "../../server/auth-actions";

function mockSupabase({
  signInResult = {
    data: { user: { id: "user-1" } as { id: string } | null },
    error: null as { message: string } | null,
  },
  aalLevel = "aal1",
}: {
  signInResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  aalLevel?: string;
} = {}) {
  const signInWithPassword = vi.fn(() => Promise.resolve(signInResult));
  const getAuthenticatorAssuranceLevel = vi.fn(() =>
    Promise.resolve({ data: { currentLevel: aalLevel }, error: null }),
  );
  const supabase = {
    auth: {
      signInWithPassword,
      mfa: { getAuthenticatorAssuranceLevel },
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return { signInWithPassword };
}

const validInput = { email: "staff@example.com", password: "password123" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveLandingPath).mockResolvedValue("/ayam-norliza-pilot/products");
  vi.mocked(syncLocaleCookieFromAccount).mockResolvedValue("en" as never);
});

describe("loginAction", () => {
  it("syncs the stored locale after a successful sign-in", async () => {
    mockSupabase();

    const result = await loginAction(validInput);

    expect(result.ok).toBe(true);
    expect(syncLocaleCookieFromAccount).toHaveBeenCalledTimes(1);
  });

  it("does not sync the locale when sign-in fails", async () => {
    mockSupabase({
      signInResult: { data: { user: null }, error: { message: "Invalid login credentials" } },
    });

    const result = await loginAction(validInput);

    expect(result.ok).toBe(false);
    expect(syncLocaleCookieFromAccount).not.toHaveBeenCalled();
  });

  it("still returns success when the locale sync throws", async () => {
    mockSupabase();
    vi.mocked(syncLocaleCookieFromAccount).mockRejectedValue(new Error("db down"));

    const result = await loginAction(validInput);

    expect(result).toEqual({
      ok: true,
      data: { requiresMfa: true, redirectTo: "/ayam-norliza-pilot/products" },
    });
  });
});
