import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// The dev server reads .env.local through Next, but the Playwright process
// does not - and fixtures like `reactivateTarget` need the service-role key
// to restore shared DB state between runs. Load it here, without clobbering
// anything already exported in the shell.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = rawValue!.trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // No .env.local (CI exports the variables directly) - nothing to load.
}

/**
 * Playwright config for the MOD-01 vertical slice.
 *
 * Prereqs: configure `.env.local` for the target Supabase project.
 * Resend is mocked at the network layer (see `e2e/_fixtures.ts`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // RLS tests share DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:9999",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Full suite, including every stateful business flow.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Layout/viewport coverage only. The stateful specs (orders, buyer
    // portal, deactivation, role change, access review, break-glass) all
    // mutate one shared database and are already covered by chromium;
    // re-running them here doubled wall-clock and made the suite
    // non-deterministic, since the second project inherits whatever state
    // the first left behind. Tablet exists to catch responsive regressions,
    // so it runs the specs whose value is what the page looks like.
    {
      name: "tablet",
      use: { ...devices["iPad Mini"] },
      testMatch: /(dashboard-shell|theme-mode|invite)\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:9999",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
