/**
 * Unit tests for facility/bay/postcode-range Server Actions. The Supabase
 * server client is mocked so no database is required; `requireOrgRole` (in
 * @/features/orders/server/guards) is exercised indirectly through the
 * actions since it has no dedicated test file of its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateFacility, createBay, addPostcodeRange, setTruckBay } from "../../server/facility-actions";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A minimal chainable Supabase query-builder stub. Every builder method
 * (select/insert/update/delete/eq/...) returns the same object so calls
 * can be chained in any order; `.single()`/`.maybeSingle()` resolve the
 * configured result, and the object is itself thenable so code that
 * `await`s the builder directly (no terminal call, e.g. a bare `.delete()`)
 * also resolves the configured result.
 */
function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "eq", "in", "or", "order", "is", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * Builds a mock Supabase client. `from("organizations")` and
 * `from("organization_members")` are wired to satisfy `requireOrgRole`;
 * any other table name is served from `tableResults`, falling back to
 * `{ data: null, error: null }`.
 */
function mockSupabaseFor({
  userId = "user-1",
  orgId = "org-1",
  role = "owner",
  tableResults = {} as Record<string, QueryResult>,
}: {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  tableResults?: Record<string, QueryResult>;
}) {
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        return chain({ data: orgId ? { id: orgId } : null, error: null });
      }
      if (table === "organization_members") {
        return chain({ data: role ? { role } : null, error: null });
      }
      if (tableResults[table]) {
        return chain(tableResults[table]);
      }
      return chain({ data: null, error: null });
    }),
    rpc: vi.fn(),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateFacility", () => {
  it("returns forbidden for a seller (managers are NOT facility admins)", async () => {
    mockSupabaseFor({ role: "seller" });

    const result = await updateFacility("ayam-norliza-pilot", "fac-1", {
      name: "Kilang Ayam",
      addressLine: "Ptd 7904",
      postcode: "82000",
      state: "Johor",
    });

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });

  it("updates the facility for an owner", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        facilities: {
          data: {
            id: "fac-1", organization_id: "org-1", name: "Kilang Ayam",
            address_line: "Ptd 7904", postcode: "82000", state: "Johor",
            is_active: true, created_by: null,
            created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z", version: 1,
          },
          error: null,
        },
      },
    });

    const result = await updateFacility("ayam-norliza-pilot", "fac-1", {
      name: "Kilang Ayam",
      addressLine: "Ptd 7904",
      postcode: "82000",
      state: "Johor",
    });

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: "fac-1" }) });
  });

  it("rejects a bad postcode with a validation error", async () => {
    mockSupabaseFor({ role: "owner" });

    const result = await updateFacility("ayam-norliza-pilot", "fac-1", {
      name: "Kilang Ayam",
      addressLine: "Ptd 7904",
      postcode: "820",
      state: "Johor",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation");
  });
});

describe("createBay", () => {
  it("allows managers (seller) to create a bay", async () => {
    mockSupabaseFor({
      role: "seller",
      tableResults: {
        facilities: { data: { id: "5b1f5c1e-0000-4000-8000-000000000001" }, error: null },
        bays: {
          data: {
            id: "bay-1", organization_id: "org-1", facility_id: "fac-1",
            name: "Bay 1", position: 0, is_active: true, created_by: "user-1",
            created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z", version: 1,
          },
          error: null,
        },
      },
    });

    const result = await createBay("ayam-norliza-pilot", {
      facilityId: "5b1f5c1e-0000-4000-8000-000000000001",
      name: "Bay 1",
    });

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: "bay-1" }) });
  });

  it("rejects a facility id that does not resolve in this org", async () => {
    mockSupabaseFor({
      role: "seller",
      tableResults: {
        facilities: { data: null, error: null },
      },
    });

    const result = await createBay("ayam-norliza-pilot", {
      facilityId: "5b1f5c1e-0000-4000-8000-000000000001",
      name: "Bay 1",
    });

    expect(result).toEqual({ ok: false, code: "validation", message: "Unknown facility" });
  });
});

describe("addPostcodeRange", () => {
  it("rejects end < start", async () => {
    mockSupabaseFor({ role: "owner" });

    const result = await addPostcodeRange("ayam-norliza-pilot", {
      zoneId: "5b1f5c1e-0000-4000-8000-000000000001",
      postcodeStart: "82300",
      postcodeEnd: "82000",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation");
  });

  it("rejects a zone id that does not resolve in this org", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        delivery_zones: { data: null, error: null },
      },
    });

    const result = await addPostcodeRange("ayam-norliza-pilot", {
      zoneId: "5b1f5c1e-0000-4000-8000-000000000001",
      postcodeStart: "82000",
      postcodeEnd: "82300",
    });

    expect(result).toEqual({ ok: false, code: "validation", message: "Unknown zone" });
  });
});

describe("setTruckBay", () => {
  it("rejects a bay id that does not resolve in this org", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        bays: { data: null, error: null },
      },
    });

    const result = await setTruckBay(
      "ayam-norliza-pilot",
      "5b1f5c1e-0000-4000-8000-000000000002",
      "5b1f5c1e-0000-4000-8000-000000000003",
    );

    expect(result).toEqual({ ok: false, code: "validation", message: "Unknown bay" });
  });
});
