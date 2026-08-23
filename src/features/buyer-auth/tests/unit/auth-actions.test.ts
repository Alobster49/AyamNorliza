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

vi.mock("@/lib/i18n/actions", () => ({
  syncLocaleCookieFromAccount: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { syncLocaleCookieFromAccount } from "@/lib/i18n/actions";
import { buyerSignUpAction, buyerSignInAction } from "../../server/auth-actions";

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
  vi.mocked(syncLocaleCookieFromAccount).mockResolvedValue("en" as never);
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
    if (!result.ok) {
      expect(result.code).toBe("internal");
      expect(result.messageKey).toBe("errors.buyer.signup.profileSaveFailed");
    }
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
    if (!result.ok) {
      expect(result.code).toBe("internal");
      expect(result.messageKey).toBe("errors.buyer.signup.profileSaveFailed");
    }
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
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.messageKey).toBe("errors.buyer.signup.createFailed");
    }
    expect(admin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("returns a validation messageKey for malformed input", async () => {
    const result = await buyerSignUpAction({ ...validInput, email: "not-an-email" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.signup.invalid");
    }
  });

  it("returns a validation messageKey for a non-Malaysian phone number", async () => {
    const result = await buyerSignUpAction({ ...validInput, phone: "not-a-phone" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.signup.invalidPhone");
    }
  });

  it("returns a validation messageKey when the organization slug does not resolve", async () => {
    const { client } = mockSupabaseFor();
    (client.from as ReturnType<typeof vi.fn>).mockImplementationOnce((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.signup.orgNotFound");
    }
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
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.messageKey).toBe("errors.buyer.account.wrongOrg");
    }
    expect(signOut).toHaveBeenCalled();
  });

  it("tells the person to log in when the password does not match", async () => {
    const { buyersInsertSpy } = mockSupabaseFor({
      signUpResult: alreadyRegistered,
      signInResult: { data: { user: null }, error: { message: "Invalid login credentials" } },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.messageKey).toBe("errors.buyer.signup.alreadyRegistered");
    }
    expect(buyersInsertSpy).not.toHaveBeenCalled();
    expect(admin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("returns signup.profileCheckFailed when checking for an existing buyer row errors", async () => {
    mockSupabaseFor({
      signUpResult: alreadyRegistered,
      signInResult: { data: { user: { id: "existing-1" } }, error: null },
      buyersSelect: { data: null, error: { message: "db down" } },
    });

    const result = await buyerSignUpAction(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("internal");
      expect(result.messageKey).toBe("errors.buyer.signup.profileCheckFailed");
    }
  });
});

describe("buyerSignInAction", () => {
  const validSignInInput = {
    email: "buyer@example.com",
    password: "password123",
  };

  function mockSupabaseForSignIn({
    signInResult = {
      data: { user: { id: "buyer-1" } as { id: string } | null },
      error: null as { message: string } | null,
    },
    buyerSelect = { data: { id: "buyer-1", organization_id: "org-1" }, error: null } as QueryResult,
  }: {
    signInResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
    buyerSelect?: QueryResult;
  } = {}) {
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    const signInWithPassword = vi.fn(() => Promise.resolve(signInResult));
    const client = {
      auth: { signInWithPassword, signOut },
      from: vi.fn((table: string) => {
        if (table === "buyers") return chain(buyerSelect);
        return chain({ data: null, error: null });
      }),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    return { signOut, signInWithPassword };
  }

  it("syncs the stored locale after a successful sign-in", async () => {
    mockSupabaseForSignIn();

    const result = await buyerSignInAction(validSignInInput);

    expect(result).toEqual({
      ok: true,
      data: { buyerId: "buyer-1" },
    });
    expect(syncLocaleCookieFromAccount).toHaveBeenCalledTimes(1);
  });

  it("does not sync the locale when the password does not match", async () => {
    mockSupabaseForSignIn({
      signInResult: { data: { user: null }, error: { message: "Invalid login credentials" } },
    });

    const result = await buyerSignInAction(validSignInInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.login.invalidCredentials");
    expect(syncLocaleCookieFromAccount).not.toHaveBeenCalled();
  });

  it("does not sync the locale when the account is not a buyer", async () => {
    const { signOut } = mockSupabaseForSignIn({
      buyerSelect: { data: null, error: { message: "not found" } },
    });

    const result = await buyerSignInAction(validSignInInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.login.notABuyer");
    expect(signOut).toHaveBeenCalled();
    expect(syncLocaleCookieFromAccount).not.toHaveBeenCalled();
  });

  it("returns a validation messageKey for malformed login input", async () => {
    const result = await buyerSignInAction({ email: "not-an-email", password: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.messageKey).toBe("errors.buyer.login.invalid");
    }
  });

  it("returns account.wrongOrg when the organization slug does not resolve to the buyer's org", async () => {
    // The default mock stubs only the "buyers" table, so the "organizations"
    // lookup below resolves to null - the same outcome as a slug for another
    // org, since both fail the `org.id === buyer.organization_id` check.
    mockSupabaseForSignIn();

    const result = await buyerSignInAction({
      ...validSignInInput,
      organizationSlug: "other-org",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messageKey).toBe("errors.buyer.account.wrongOrg");
  });

  it("still returns success when the locale sync throws", async () => {
    mockSupabaseForSignIn();
    vi.mocked(syncLocaleCookieFromAccount).mockRejectedValue(new Error("db down"));

    const result = await buyerSignInAction(validSignInInput);

    expect(result).toEqual({ ok: true, data: { buyerId: "buyer-1" } });
  });
});
