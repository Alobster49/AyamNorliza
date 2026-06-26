import "server-only";

export type UntypedSupabase = {
  from: (table: string) => any;
};

export function untypedDb(client: unknown): UntypedSupabase {
  return client as UntypedSupabase;
}
