/**
 * Unit tests for buyer auth Server Actions, focused on the signup
 * rollback path: when the `buyers` insert fails after `auth.signUp`
 * succeeded, the orphaned auth user must be deleted via the
 * service-role admin client (the anon-key server client cannot call
 * `auth.admin.*`), and the just-created session must be signed out so
 * no cookie points at a deleted user. Mock idiom copied from
 * `src/features/buyer/tests/unit/address-actions.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  admin: {
    deleteAuthUser: vi.fn(),
  },
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { buyerSignUpAction } from "../../server/auth-actions";

type QueryResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "order", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const validInput = {
  email: "buyer@example.com",
  password: "password123",
  displayName: "Kak Norliza",
  phone: "0123456789",
  organizationSlug: "ayam-norliza",
};

function mockSupabaseFor({
  signUpResult = {
    data: { user: { id: "user-1" } },
    error: null as { message: string } | null,
  },
  buyersInsert = { data: null, error: null } as QueryResult,
}: {
  signUpResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  buyersInsert?: QueryResult;
} = {}) {
  const signOut = vi.fn(() => Promise.resolve({ error: null }));
  const client = {
    auth: {
      signUp: vi.fn(() => Promise.resolve(signUpResult)),
      signOut,
    },
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return chain({ data: { id: "org-1" }, error: null });
      }
      if (table === "buyers") {
        return chain(buyersInsert);
      }
      return chain({ data: null, error: null });
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return { client, signOut };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(admin.deleteAuthUser).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buyerSignUpAction", () => {
  it("returns the buyer id when signup and buyers insert both succeed", async () => {
    mockSupabaseFor();

    const result = await buyerSignUpAction(validInput);

    expect(result).toEqual({ ok: true, data: { buyerId: "user-1" } });
    expect(admin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("rolls back the auth user via the admin client when the buyers insert fails", async () => {
    const { signOut } = mockSupabaseFor({
      buyersInsert: { data: null, error: { message: "RLS violation" } },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("internal");
    expect(admin.deleteAuthUser).toHaveBeenCalledWith("user-1");
    expect(signOut).toHaveBeenCalled();
  });

  it("still reports the insert failure when the rollback itself throws", async () => {
    vi.mocked(admin.deleteAuthUser).mockRejectedValue(new Error("admin down"));
    mockSupabaseFor({
      buyersInsert: { data: null, error: { message: "RLS violation" } },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("internal");
  });

  it("returns conflict without touching the admin client when signUp itself fails", async () => {
    mockSupabaseFor({
      signUpResult: {
        data: { user: null },
        error: { message: "User already registered" },
      },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
    expect(admin.deleteAuthUser).not.toHaveBeenCalled();
  });
});
