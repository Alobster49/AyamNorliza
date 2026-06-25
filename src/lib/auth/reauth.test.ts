import { describe, it, expect, vi } from "vitest";

// Hoisted mocks. `vi.mock` is hoisted by Vitest, but the env stubs
// must be set before any module that reads them is imported.
process.env.REAUTH_COOKIE_SECRET ??= "test-only-32-byte-secret-do-not-use-prod";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
process.env.SUPABASE_DB_URL ??= "postgresql://x:x@x/x";
process.env.RESEND_API_KEY ??= "re_test";
process.env.EMAIL_FROM ??= "t@t.com";
process.env.INVITE_BASE_URL ??= "http://localhost:3000";
process.env.SITE_URL ??= "http://localhost:3000";
process.env.TOTP_ISSUER ??= "AyamNorliza";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "dummy";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-x", email: "x@example.com" } },
        error: null,
      }),
    },
  }),
}));

// Dynamic import AFTER the mocks are set so the modules see them.
const { setReauthCookie, readReauthProof, clearReauthCookie } = await import("@/lib/auth/reauth");
const { requireReauth, ReauthRequiredError } = await import("@/lib/auth/reauth.server");

describe("reauth cookie", () => {
  it("setReauthCookie stores a signed payload; readReauthProof validates it", async () => {
    cookieStore.clear();
    const { jti } = await setReauthCookie("11111111-1111-1111-1111-111111111111");
    expect(jti.length).toBeGreaterThan(0);
    const proof = await readReauthProof("11111111-1111-1111-1111-111111111111");
    expect(proof?.jti).toBe(jti);
  });

  it("readReauthProof rejects mismatched userId", async () => {
    cookieStore.clear();
    await setReauthCookie("user-a");
    const proof = await readReauthProof("user-b");
    expect(proof).toBeNull();
  });

  it("clearReauthCookie removes the entry", async () => {
    cookieStore.clear();
    await setReauthCookie("user-a");
    await clearReauthCookie();
    const proof = await readReauthProof("user-a");
    expect(proof).toBeNull();
  });
});

describe("requireReauth", () => {
  it("throws ReauthRequiredError when no cookie", async () => {
    cookieStore.clear();
    await expect(requireReauth()).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("returns userId when cookie is valid", async () => {
    cookieStore.clear();
    await setReauthCookie("user-x");
    const { userId } = await requireReauth();
    expect(userId).toBe("user-x");
  });
});
