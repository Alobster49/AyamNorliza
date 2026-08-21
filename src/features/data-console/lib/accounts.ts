/**
 * The two always-available console logins the Seed action guarantees.
 * Client-safe: the shared password lives server-side in
 * server/actions.ts (an accepted, documented risk for this pilot —
 * see docs/superpowers/specs/2026-08-22-data-console-design.md).
 */
export const CONSOLE_ACCOUNTS = [
  { email: "badrol@gmail.com", displayName: "Badrol", role: "owner" },
  { email: "hafizzudinsamad@gmail.com", displayName: "Hafizzudin Samad", role: "org_admin" },
] as const;
