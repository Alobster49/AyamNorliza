/**
 * Shared Supabase mocking helpers for the Task 5 `messageKey` assertion
 * suites (actions.test.ts, roles.test.ts). Mock idiom copied from
 * `src/features/buyer/tests/unit/actions.test.ts` and
 * `src/features/identity-access/tests/unit/landing.test.ts`, extended with
 * a per-table result *queue* since these Server Actions frequently issue
 * two sequential queries against the same table (e.g. `organization_members`
 * for both the target row and the caller's own membership row).
 */
import { vi } from "vitest";

export type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function chain(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "order", "limit"];
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
 * `tableQueues.users` (say) is consumed in call order: the first `.from("users")`
 * gets `tableQueues.users[0]`, the second gets `[1]`, etc. A table with no
 * queue left (or not present) falls back to `{ data: null, error: null }`.
 */
export function mockSupabaseWithQueues({
  userId = "user-1" as string | null,
  tableQueues = {} as Record<string, QueryResult[]>,
}: {
  userId?: string | null;
  tableQueues?: Record<string, QueryResult[]>;
} = {}) {
  const cursors: Record<string, number> = {};
  const from = vi.fn((table: string) => {
    const queue = tableQueues[table] ?? [];
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const result = queue[idx] ?? { data: null, error: null };
    return chain(result);
  });
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    from,
  };
  return supabase;
}
