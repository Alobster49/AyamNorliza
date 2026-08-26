/**
 * The console logins the Seed action guarantees -- one per role a screen
 * actually gates on, so every part of the app can be opened without hand-
 * making accounts. Client-safe: the shared password lives server-side in
 * server/actions.ts (an accepted, documented risk for this pilot --
 * see docs/superpowers/specs/2026-08-22-data-console-design.md).
 *
 * Role notes:
 * - `inventory` is what Warehouse tasks needs (STAFF_ROLES).
 * - Loading and Dispatch gate on DISPATCH_ROLES (owner/org_admin/seller/
 *   logistics), so those are reached with the owner or seller login.
 * - the two drivers exist so a seeded run can be handed to one of them and
 *   the other still shows an empty deck.
 */
export const CONSOLE_ACCOUNTS = [
  { email: "owner@gmail.com", displayName: "CEO Badrol", role: "owner" },
  { email: "admin@gmail.com", displayName: "Hafiz Samad", role: "org_admin" },
  { email: "seller@gmail.com", displayName: "Seller", role: "seller" },
  { email: "warehouse@gmail.com", displayName: "Warehouse", role: "inventory" },
  { email: "driver1@gmail.com", displayName: "Driver One", role: "driver" },
  { email: "driver2@gmail.com", displayName: "Driver Two", role: "driver" },
] as const;

/** The driver logins, in the order seeded runs are handed out. */
export const CONSOLE_DRIVER_EMAILS = CONSOLE_ACCOUNTS.filter(
  (a) => a.role === "driver",
).map((a) => a.email);
