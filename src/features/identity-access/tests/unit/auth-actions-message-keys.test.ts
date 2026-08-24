/**
 * Key-assertion tests for `src/features/identity-access/server/auth-actions.ts`.
 * Sibling to `auth-actions.test.ts` (which covers `loginAction`'s locale-sync
 * behavior) — kept separate so this suite can focus purely on the
 * `messageKey` contract across every action in the file. Mock idiom copied
 * from `auth-actions.test.ts` / `actions-message-keys.test.ts`.
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

vi.mock("@/lib/auth/reauth", () => ({
  setReauthCookie: vi.fn(),
  clearReauthCookie: vi.fn(),
}));

vi.mock("@/lib/auth/mfa", () => ({
  listFactors: vi.fn(),
  startEnroll: vi.fn(),
  verifyChallenge: vi.fn(),
  unenroll: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  admin: { insertAuthSecurityEvent: vi.fn() },
}));

vi.mock("@/lib/env", () => ({
  serverEnv: vi.fn(() => ({ SITE_URL: "https://example.com" })),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "../../server/landing";
import { listFactors, verifyChallenge } from "@/lib/auth/mfa";
import {
  loginAction,
  reauthAction,
  startMfaEnrollAction,
  verifyMfaChallengeAction,
  unenrollMfaAction,
  signUpAction,
} from "../../server/auth-actions";

function mockSupabase({
  userId = "user-1" as string | null,
  signInResult = { data: { user: { id: "user-1" } as { id: string } | null }, error: null as { message: string } | null },
  signUpResult = undefined as { data: unknown; error: { message: string; code?: string } | null } | undefined,
}: {
  userId?: string | null;
  signInResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  signUpResult?: { data: unknown; error: { message: string; code?: string } | null };
} = {}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId, email: "a@b.com" } : null }, error: null }),
      signInWithPassword: vi.fn(() => Promise.resolve(signInResult)),
      signUp: vi.fn(() => Promise.resolve(signUpResult ?? { data: { user: null, session: null }, error: null })),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn(() => Promise.resolve({ data: { currentLevel: "aal1" }, error: null })) },
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveLandingPath).mockResolvedValue("/ayam-norliza-pilot/products");
  vi.mocked(listFactors).mockResolvedValue({ totp: [] } as never);
});

describe("loginAction", () => {
  it("returns auth.invalidLogin for a bad payload", async () => {
    const result = await loginAction({ email: "not-an-email", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.invalidLogin");
  });

  it("returns auth.invalidCredentials when sign-in fails", async () => {
    mockSupabase({ signInResult: { data: { user: null }, error: { message: "Invalid login credentials" } } });
    const result = await loginAction({ email: "a@b.com", password: "password123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.invalidCredentials");
  });
});

describe("reauthAction", () => {
  it("returns auth.invalidReauthInput for a bad payload", async () => {
    const result = await reauthAction({ password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.invalidReauthInput");
  });

  it("returns common.unauthenticated when signed out", async () => {
    mockSupabase({ userId: null });
    const result = await reauthAction({ password: "password123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.unauthenticated");
  });

  it("returns auth.passwordMismatch when the password re-check fails", async () => {
    mockSupabase({ signInResult: { data: { user: null }, error: { message: "wrong" } } });
    const result = await reauthAction({ password: "password123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.passwordMismatch");
  });

  it("returns auth.mfaCodeRequired when a TOTP factor exists and no code was given", async () => {
    mockSupabase();
    vi.mocked(listFactors).mockResolvedValue({ totp: [{ id: "factor-1" }] } as never);
    const result = await reauthAction({ password: "password123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.mfaCodeRequired");
  });

  it("returns auth.mfaCodeMismatch when the TOTP code doesn't verify", async () => {
    mockSupabase();
    vi.mocked(listFactors).mockResolvedValue({ totp: [{ id: "factor-1" }] } as never);
    vi.mocked(verifyChallenge).mockResolvedValue({ success: false, error: "bad code" } as never);
    const result = await reauthAction({ password: "password123", totpCode: "123456" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.mfaCodeMismatch");
  });
});

describe("startMfaEnrollAction", () => {
  it("returns common.unauthenticated when signed out", async () => {
    mockSupabase({ userId: null });
    const result = await startMfaEnrollAction();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.unauthenticated");
  });
});

describe("verifyMfaChallengeAction", () => {
  it("returns common.invalidInput for a bad payload", async () => {
    const result = await verifyMfaChallengeAction({ factorId: "not-a-uuid", code: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.invalidInput");
  });

  it("returns common.unauthenticated when signed out", async () => {
    mockSupabase({ userId: null });
    const result = await verifyMfaChallengeAction({ factorId: "11111111-1111-1111-1111-111111111111", code: "123456" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.unauthenticated");
  });

  it("returns auth.mfaVerifyFailed for a bad code, regardless of the raw Supabase error text", async () => {
    mockSupabase();
    vi.mocked(verifyChallenge).mockResolvedValue({ success: false, error: "some raw supabase text" } as never);
    const result = await verifyMfaChallengeAction({ factorId: "11111111-1111-1111-1111-111111111111", code: "123456" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.mfaVerifyFailed");
  });
});

describe("unenrollMfaAction", () => {
  it("returns common.invalidInput for a bad payload", async () => {
    const result = await unenrollMfaAction({ factorId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.invalidInput");
  });

  it("returns common.unauthenticated when signed out", async () => {
    mockSupabase({ userId: null });
    const result = await unenrollMfaAction({ factorId: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.common.unauthenticated");
  });
});

describe("signUpAction", () => {
  const validInput = { email: "new@example.com", password: "password12345", displayName: "New User" };

  it("returns auth.invalidSignup for a bad payload", async () => {
    const result = await signUpAction({ email: "not-an-email", password: "short", displayName: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.invalidSignup");
  });

  it("returns auth.alreadyRegistered when Supabase reports a duplicate email", async () => {
    mockSupabase({
      signUpResult: { data: { user: null, session: null }, error: { message: "User already registered" } },
    });
    const result = await signUpAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.alreadyRegistered");
  });

  it("returns auth.signupFailed for any other Supabase signUp error", async () => {
    mockSupabase({
      signUpResult: { data: { user: null, session: null }, error: { message: "Something else broke" } },
    });
    const result = await signUpAction(validInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.identity.auth.signupFailed");
  });
});
