/**
 * The console logins the Seed action guarantees -- one per role a screen
 * actually gates on, so every part of the app can be opened without hand-
 * making accounts. Client-safe: the shared password lives server-side in
 * server/actions.ts (an accepted, documented risk for this pilot --
 * see docs/superpowers/specs/2026-08-22-data-console-design.md).
 *
 * Role notes:
 * - `hr` is what the leave module gates on (LEAVE_APPROVER_ROLES) --
 *   src/features/hr/lib/roles.ts.
 * - `inventory` is what Warehouse tasks needs (STAFF_ROLES).
 * - Loading and Dispatch gate on DISPATCH_ROLES (owner/org_admin/seller/
 *   logistics), so those are reached with the owner or seller login.
 * - the two drivers exist so seeded runs can be split across them: the
 *   round-robin in seedDemoData hands out every non-completed run in
 *   run_date order, and the seed now creates two live runs today so both
 *   decks have stops -- useful for watching realtime updates across drivers.
 */
export const CONSOLE_ACCOUNTS = [
  { email: "owner@gmail.com", displayName: "CEO Badrol", role: "owner" },
  { email: "admin@gmail.com", displayName: "Hafiz Samad", role: "org_admin" },
  { email: "hr@gmail.com", displayName: "HR Manager", role: "hr" },
  { email: "seller@gmail.com", displayName: "Seller", role: "seller" },
  { email: "warehouse@gmail.com", displayName: "Warehouse", role: "inventory" },
  { email: "driver1@gmail.com", displayName: "Driver One", role: "driver" },
  { email: "driver2@gmail.com", displayName: "Driver Two", role: "driver" },
] as const;

/** The driver logins, in the order seeded runs are handed out. */
export const CONSOLE_DRIVER_EMAILS = CONSOLE_ACCOUNTS.filter(
  (a) => a.role === "driver",
).map((a) => a.email);

/**
 * The real-world seed's driver fleet: one driver per truck, 30 of each.
 * driver<N>@gmail.com always drives truck JHR-<N> -- the data console's
 * real-world seed action ensures these accounts exist and assigns each to
 * its truck's live run, so any of them can be picked in the dev sign-in to
 * open a driver deck with stops on it.
 *
 * driver1/driver2 overlap the demo seed's CONSOLE_ACCOUNTS on purpose (same
 * emails, so the two seeds never strand a login); whichever seed ran last
 * owns the display name.
 */
const REALWORLD_DRIVER_NAMES = [
  "Azman Ismail", "Faizal Rahman", "Syafiq Hassan", "Hairul Anuar",
  "Zulkifli Omar", "Ridzuan Baharin", "Khairul Amin", "Nazri Salleh",
  "Firdaus Yusof", "Amirul Hakim", "Shahrul Nizam", "Izwan Roslan",
  "Hafizi Bakar", "Rosli Ahmad", "Saiful Azhar", "Zainal Abidin",
  "Megat Danial", "Farid Kamal", "Asyraf Zainuddin", "Lokman Hakim",
  "Syazwan Idris", "Rahim Daud", "Aiman Zaki", "Halim Osman",
  "Nabil Fikri", "Imran Shah", "Taufik Hidayat", "Zaidi Musa",
  "Akmal Hafiz", "Sulaiman Jaafar",
] as const;

export const REALWORLD_DRIVER_ACCOUNTS = REALWORLD_DRIVER_NAMES.map(
  (name, i) => ({
    email: `driver${i + 1}@gmail.com`,
    displayName: name,
    role: "driver" as const,
    truckCode: `JHR-${String(i + 1).padStart(2, "0")}`,
  }),
);
