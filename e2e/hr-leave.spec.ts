import { test, expect } from "@playwright/test";
import { signIn, OWNER, TARGET } from "./_fixtures";

/**
 * Applier applies for annual leave -> approver approves -> applier's balance
 * drops. Covers the full round trip across the two HR leave screens shipped
 * in Tasks 7-8 (`/leave` and `/leave/manage`).
 *
 * Accounts: both come from `supabase/seed.sql`'s pilot-org fixtures (the same
 * ones `e2e/_fixtures.ts` already exports), so this spec is reproducible from
 * a bare `npm run db:reset` with no data-console seeding step. TARGET
 * (driver) is an ordinary member — any role in ALL_MEMBER_ROLES may open
 * `/leave` (src/features/hr/lib/roles.ts) — and OWNER's `owner` role sits in
 * LEAVE_APPROVER_ROLES, so it can decide requests on `/leave/manage`.
 */

test("member applies annual leave, owner approves, balance drops", async ({ page, browser }) => {
  test.setTimeout(120_000);

  // Unique per run so the approver's pending queue (which does show the
  // applicant's justification text) can pick out exactly this request even
  // when earlier runs left approved/rejected requests behind in the same
  // local database.
  const justification = `E2E family matter ${Date.now()}`;

  // Applier applies for two clean December workdays - Tue/Wed with no MY
  // public holiday nearby (see the holiday seed in
  // supabase/migrations/20260830000001_hr_leave_schema.sql).
  await signIn(page, TARGET.email, TARGET.password);
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

  // The applier's own history table never renders the justification text
  // (only type/date/count/status/comment - see leave-history.tsx), so it
  // can't be used to pick out the row. `getMyLeaveData` orders requests by
  // created_at descending, so the request just submitted is always the top
  // body row - true on every rerun even when older rows for the same dates
  // already exist from a previous run of this spec.
  const historyRow = page.locator("table tbody tr").first();
  await expect(historyRow).toContainText(/pending/i, { timeout: 10_000 });
  await expect(historyRow).toContainText("1 Dec - 2 Dec, Tue - Wed");

  // Approver decides in a fresh context.
  const approverContext = await browser.newContext();
  const approverPage = await approverContext.newPage();
  await signIn(approverPage, OWNER.email, OWNER.password);
  await approverPage.goto("/ayam-norliza-pilot/leave/manage");
  const pendingCard = approverPage.getByTestId("pending-request").filter({ hasText: justification });
  await expect(pendingCard).toBeVisible({ timeout: 10_000 });
  await pendingCard.getByRole("button", { name: /^approve$/i }).click();
  // Confirming re-uses the same "Approve" label on the note dialog's submit button.
  await approverPage.getByRole("dialog").getByRole("button", { name: /^approve$/i }).click();
  await expect(pendingCard).toBeHidden({ timeout: 10_000 });

  // Applier sees APPROVED and a lower available balance.
  await page.reload();
  await expect(historyRow).toContainText(/approved/i, { timeout: 10_000 });
  const after = await page.getByTestId("annual-available").innerText();
  expect(parseFloat(after)).toBeLessThan(parseFloat(before));

  await approverContext.close();
});
