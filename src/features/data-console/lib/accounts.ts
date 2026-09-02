/**
 * The console logins the Seed action guarantees -- one per role a screen
 * actually gates on, so every part of the app can be opened without hand-
 * making accounts. Client-safe: the shared password lives server-side in
 * server/actions.ts (an accepted, documented risk for this pilot --
 * see docs/superpowers/specs/2026-08-22-data-console-design.md).
 *
 * Role notes:
 * - `org_admin` (label "Admin") has full access, including the data
 *   console; `owner` has everything except the data console.
 * - `hr` is what the leave module gates on (LEAVE_APPROVER_ROLES) --
 *   src/features/hr/lib/roles.ts.
 * - `supervisor` mirrors seller (sales + dispatch + delivery).
 * - `inventory` (label "Worker") is what Warehouse tasks and Loading need
 *   (WAREHOUSE_ROLES).
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
  { email: "supervisor@gmail.com", displayName: "Supervisor", role: "supervisor" },
  { email: "worker@gmail.com", displayName: "Worker", role: "inventory" },
  { email: "driver1@gmail.com", displayName: "Driver One", role: "driver" },
  { email: "driver2@gmail.com", displayName: "Driver Two", role: "driver" },
] as const;

/** The driver logins, in the order seeded runs are handed out. */
export const CONSOLE_DRIVER_EMAILS = CONSOLE_ACCOUNTS.filter(
  (a) => a.role === "driver",
).map((a) => a.email);

/**
 * The real-world seed's driver fleet: one driver per truck for JHR-01..30
 * (driver<N>@gmail.com always drives truck JHR-<N>) plus two cover-pool
 * drivers, driver31 and driver32, who have no truck of their own and step in
 * when a regular driver is on leave (see the roster). The data console's
 * real-world seed action ensures all 32 accounts exist and hands the
 * truck-code -> user-id map to the SQL seed, which sets each truck's regular
 * driver and books the leave/cover scenarios.
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
  // Cover pool: no regular truck.
  "Hakim Roslan", "Fauzi Mansor",
] as const;

/** Trucks JHR-01..JHR-30 have a regular driver; the rest of the list is the cover pool. */
const TRUCK_DRIVER_COUNT = 30;

export const REALWORLD_DRIVER_ACCOUNTS = REALWORLD_DRIVER_NAMES.map(
  (name, i) => ({
    email: `driver${i + 1}@gmail.com`,
    displayName: name,
    role: "driver" as const,
    truckCode:
      i < TRUCK_DRIVER_COUNT
        ? `JHR-${String(i + 1).padStart(2, "0")}`
        : null,
  }),
);
