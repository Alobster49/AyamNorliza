/**
 * Unit tests for buyer auth Server Actions, focused on the signup
 * rollback path: when the `buyers` insert fails after `auth.signUp`
 * succeeded, the orphaned auth user must be deleted via the
 * service-role admin client (the anon-key server client cannot call
 * `auth.admin.*`), and the just-created session must be signed out so
 * no cookie points at a deleted user; and on the adopt path, where the
 * email already owns an auth user (a console/staff login, or a buyer whose
 * profile row was wiped by a data reset) and the signup must attach a buyer
 * profile to it instead of dead-ending. Mock idiom copied from
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

function chain(result: QueryResult, readResult: QueryResult = result) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "order", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(readResult));
  builder.maybeSingle = vi.fn(() => Promise.resolve(readResult));
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
  buyersSelect = { data: null, error: null } as QueryResult,
  signInResult = {
    data: { user: null as { id: string } | null },
    error: { message: "Invalid login credentials" } as { message: string } | null,
  },
}: {
  signUpResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  buyersInsert?: QueryResult;
  buyersSelect?: QueryResult;
  signInResult?: {
    data: { user: { id: string } | null };
    error: { message: string } | null;
  };
} = {}) {
  const signOut = vi.fn(() => Promise.resolve({ error: null }));
  const signInWithPassword = vi.fn(() => Promise.resolve(signInResult));
  const buyersInsertSpy = vi.fn();
  const client = {
    auth: {
      signUp: vi.fn(() => Promise.resolve(signUpResult)),
      signInWithPassword,
      signOut,
    },
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return chain({ data: { id: "org-1" }, error: null });
      }
      if (table === "buyers") {
        const builder = chain(buyersInsert, buyersSelect);
        const realInsert = builder.insert as (row: unknown) => unknown;
        builder.insert = vi.fn((row: unknown) => {
          buyersInsertSpy(row);
          return realInsert(row);
        });
        return builder;
      }
      return chain({ data: null, error: null });
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return { client, signOut, signInWithPassword, buyersInsertSpy };
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
        error: { message: "Database error saving new user" },
      },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
    expect(admin.deleteAuthUser).not.toHaveBeenCalled();
  });
});

describe("buyerSignUpAction on an email that already has an auth user", () => {
  const alreadyRegistered = {
    data: { user: null },
    error: { message: "User already registered" },
  };

  it("attaches a buyer profile when the password proves the account is theirs", async () => {
    const { buyersInsertSpy } = mockSupabaseFor({
      signUpResult: alreadyRegistered,
      signInResult: { data: { user: { id: "existing-1" } }, error: null },
      buyersSelect: { data: null, error: null },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result).toEqual({ ok: true, data: { buyerId: "existing-1" } });
    expect(buyersInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "existing-1", organization_id: "org-1" }),
    );
    // The auth user pre-dates this signup — rolling it back would delete a
    // console/staff login.
    expect(admin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("returns the existing buyer id without a second insert", async () => {
    const { buyersInsertSpy } = mockSupabaseFor({
      signUpResult: alreadyRegistered,
      signInResult: { data: { user: { id: "existing-1" } }, error: null },
      buyersSelect: { data: { id: "existing-1", organization_id: "org-1" }, error: null },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result).toEqual({ ok: true, data: { buyerId: "existing-1" } });
    expect(buyersInsertSpy).not.toHaveBeenCalled();
  });

  it("signs out and refuses when the existing buyer belongs to another org", async () => {
    const { signOut } = mockSupabaseFor({
      signUpResult: alreadyRegistered,
      signInResult: { data: { user: { id: "existing-1" } }, error: null },
      buyersSelect: { data: { id: "existing-1", organization_id: "org-other" }, error: null },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
    expect(signOut).toHaveBeenCalled();
  });

  it("tells the person to log in when the password does not match", async () => {
    const { buyersInsertSpy } = mockSupabaseFor({
      signUpResult: alreadyRegistered,
      signInResult: { data: { user: null }, error: { message: "Invalid login credentials" } },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
    expect(buyersInsertSpy).not.toHaveBeenCalled();
    expect(admin.deleteAuthUser).not.toHaveBeenCalled();
  });
});
