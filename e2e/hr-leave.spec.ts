import { test, expect } from "@playwright/test";
import { signIn } from "./_fixtures";

/**
 * Worker applies for annual leave -> HR approves -> worker's balance drops.
 * Covers the full round trip across the two HR leave screens shipped in
 * Tasks 7-8 (`/leave` and `/leave/manage`).
 *
 * Accounts: both are console demo logins (src/features/data-console/lib/
 * accounts.ts), password123 per CLAUDE.md's test-account contract. They must
 * already exist in the target Supabase project - either seeded once via the
 * data console's "Seed demo data" action (as an owner) or provisioned
 * directly with the service-role key the same way that action does
 * (createUser + profile/membership upsert). `supabase/seed.sql` alone does
 * NOT create warehouse@gmail.com and gives hr@gmail.com a different
 * password, so a bare `npm run db:reset` is not sufficient on its own.
 */
const WORKER = { email: "warehouse@gmail.com", password: "password123" };
const HR = { email: "hr@gmail.com", password: "password123" };

test("worker applies annual leave, HR approves, balance drops", async ({ page, browser }) => {
  test.setTimeout(120_000);

  // Unique per run so the HR pending queue (which does show the applicant's
  // justification text) can pick out exactly this request even when earlier
  // runs left approved/rejected requests behind in the same local database.
  const justification = `E2E family matter ${Date.now()}`;

  // Worker applies for two clean December workdays - Tue/Wed with no MY
  // public holiday nearby (see the holiday seed in
  // supabase/migrations/20260830000001_hr_leave_schema.sql).
  await signIn(page, WORKER.email, WORKER.password);
  await page.goto("/ayam-norliza-pilot/leave");
  const before = await page.getByTestId("annual-available").innerText();

  await page.getByRole("button", { name: /^apply leave$/i }).click();
  const dialog = page.getByRole("dialog");
  // The type list is plain radio inputs, not a RadioGroup primitive - each
  // row's accessible name is "<type name> <n> remaining" (apply-leave-dialog.tsx).
  await dialog.getByRole("radio", { name: /annual/i }).check();
  await dialog.getByLabel(/start date/i).fill("2026-12-01");
  await dialog.getByLabel(/end date/i).fill("2026-12-02");
  await dialog.getByLabel(/justification/i).fill(justification);
  await dialog.getByRole("button", { name: /^apply$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // The worker's own history table never renders the justification text
  // (only type/date/count/status/comment - see leave-history.tsx), so it
  // can't be used to pick out the row. `getMyLeaveData` orders requests by
  // created_at descending, so the request just submitted is always the top
  // body row - true on every rerun even when older rows for the same dates
  // already exist from a previous run of this spec.
  const historyRow = page.locator("table tbody tr").first();
  await expect(historyRow).toContainText(/pending/i, { timeout: 10_000 });
  await expect(historyRow).toContainText("1 Dec - 2 Dec, Tue - Wed");

  // HR approves in a fresh context.
  const hrContext = await browser.newContext();
  const hrPage = await hrContext.newPage();
  await signIn(hrPage, HR.email, HR.password);
  await hrPage.goto("/ayam-norliza-pilot/leave/manage");
  const pendingCard = hrPage.getByTestId("pending-request").filter({ hasText: justification });
  await expect(pendingCard).toBeVisible({ timeout: 10_000 });
  await pendingCard.getByRole("button", { name: /^approve$/i }).click();
  // Confirming re-uses the same "Approve" label on the note dialog's submit button.
  await hrPage.getByRole("dialog").getByRole("button", { name: /^approve$/i }).click();
  await expect(pendingCard).toBeHidden({ timeout: 10_000 });

  // Worker sees APPROVED and a lower available balance.
  await page.reload();
  await expect(historyRow).toContainText(/approved/i, { timeout: 10_000 });
  const after = await page.getByTestId("annual-available").innerText();
  expect(parseFloat(after)).toBeLessThan(parseFloat(before));

  await hrContext.close();
});
