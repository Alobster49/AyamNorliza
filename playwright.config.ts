import { defineConfig, devices } from "@playwright/test";

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
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "tablet", use: { ...devices["iPad Mini"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
