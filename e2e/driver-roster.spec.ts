import { test, expect, type Page } from "@playwright/test";
import { OWNER, TARGET, dismissToasts, seedZoneWithCoverage, signIn } from "./_fixtures";

/**
 * Read the roster's "N gaps" alert pill. The pilot org's base fixtures
 * (TRK-A, TRK-B, both with no regular driver) already put the roster in a
 * many-gaps state on a bare `db:reset`, so this spec can't assert a literal
 * "1 gap" -- it reads the count before and after each of its own writes and
 * asserts the delta instead. `AlertPill` renders nothing at all when there
 * are zero gaps and zero risks, so an absent pill reads as 0.
 *
 * This spec is NOT idempotent: it seeds a truck per run and the pilot org
 * has exactly one driver, so run it against a fresh `npm run db:reset`.
 */
async function gapCount(page: Page): Promise<number> {
  const pill = page.getByTestId("roster-gap-count");
  if ((await pill.count()) === 0) return 0;
  const text = await pill.innerText();
  return Number(/(\d+)\s*gap/.exec(text)?.[1] ?? "0");
}

/**
 * The whole cover loop on one freshly seeded truck:
 *   A. no regular driver -> tomorrow is a gap -> assign TARGET as cover ->
 *      the cell flips to TARGET and the gap count drops by one.
 *   B. clear that cover -> the gap comes back.
 *   C. make TARGET the truck's regular driver, TARGET takes emergency leave
 *      tomorrow, owner approves -> the cell reads "No driver" again and the
 *      count rises by one over the post-regular baseline.
 * Emergency leave is upon-request with no advance-notice rule, so tomorrow
 * is a legal date (annual leave would need 7 days' notice).
 */
test("assigning and clearing a cover, then approved leave, move the roster gap count", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString().slice(-6);
  const truckCode = `RST-${stamp}`;
  // Local Y-M-D, not `toISOString().slice(0, 10)`: this machine runs at
  // UTC+8, so a UTC-based conversion of "tomorrow" rolls back to today
  // whenever local time is before 08:00, landing the leave request on the
  // wrong date and leaving the roster showing "regular" instead of "gap".
  // seedZoneWithCoverage (_fixtures.ts) computes its slot weekday the same
  // local way via `tomorrow.getDay()`, so this keeps the two in sync.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  await signIn(page, OWNER.email, OWNER.password);
  await seedZoneWithCoverage(page, `Roster zone ${stamp}`, `Roster truck ${stamp}`, truckCode);

  await page.goto("/ayam-norliza-pilot/roster");
  const truckRow = page.getByTestId(`roster-truck-row-${truckCode}`);
  // The truck's only slot is on tomorrow's weekday, which falls twice inside
  // the default 14-day window -- so "the button named /no driver/i" is
  // ambiguous. Every clickable cell carries a `title` of
  // "{code} · {ISO date} · {state}" (roster-grid.tsx), which pins the column.
  const tomorrowCell = truckRow.locator(`button[title*="${tomorrowIso}"]`);

  // --- A. assign a cover on a truck that has no regular driver -------------
  await expect(tomorrowCell).toHaveAccessibleName(/no driver/i, { timeout: 15_000 });
  const gapsBeforeCover = await gapCount(page);

  await tomorrowCell.click();
  const assign = page.getByRole("dialog");
  await assign.getByRole("radio", { name: /target/i }).click();
  await assign.getByRole("button", { name: /^assign .* to /i }).click();
  await expect(assign).toBeHidden({ timeout: 15_000 });
  await dismissToasts(page);

  await expect(tomorrowCell).toHaveAccessibleName(/target/i, { timeout: 15_000 });
  await expect.poll(() => gapCount(page), { timeout: 15_000 }).toBe(gapsBeforeCover - 1);

  // --- B. clear it again ---------------------------------------------------
  await tomorrowCell.click();
  const clearDialog = page.getByRole("dialog");
  await clearDialog.getByRole("button", { name: /^clear cover$/i }).click();
  await expect(clearDialog).toBeHidden({ timeout: 15_000 });
  await dismissToasts(page);

  await expect(tomorrowCell).toHaveAccessibleName(/no driver/i, { timeout: 15_000 });
  await expect.poll(() => gapCount(page), { timeout: 15_000 }).toBe(gapsBeforeCover);

  // --- C. regular driver + approved leave ----------------------------------
  await page.getByRole("button", { name: /set regular drivers/i }).click();
  const dialog = page.getByRole("dialog");
  // selectOption's `label` matcher takes a string, not a RegExp (unlike
  // getByRole/getByLabel) -- TARGET's seeded display name is "Target User"
  // (supabase/seed.sql).
  await dialog.getByLabel(new RegExp(truckCode)).selectOption({ label: "Target User" });
  await dialog.getByRole("button", { name: /^save$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await dismissToasts(page);
  // The dialog's onDone() kicks off its own client refresh() fetch that the
  // dialog closing does not wait on, so a baseline read straight after
  // toBeHidden() can still see the truck's pre-assignment gaps. Reload for a
  // fresh SSR read of the now-committed regularDriverId instead of racing it.
  await page.reload();
  const baselineGaps = await gapCount(page);

  // TARGET applies emergency leave for tomorrow.
  const driverContext = await browser.newContext();
  const driverPage = await driverContext.newPage();
  await signIn(driverPage, TARGET.email, TARGET.password);
  await driverPage.goto("/ayam-norliza-pilot/leave");
  await driverPage.getByRole("button", { name: /^apply leave$/i }).click();
  const apply = driverPage.getByRole("dialog");
  await apply.getByRole("radio", { name: /emergency/i }).check();
  await apply.getByLabel(/start date/i).fill(tomorrowIso);
  await apply.getByLabel(/end date/i).fill(tomorrowIso);
  await apply.getByLabel(/justification/i).fill(`E2E roster gap ${stamp}`);
  await apply.getByRole("button", { name: /^apply$/i }).click();
  await expect(apply).toBeHidden({ timeout: 10_000 });
  await driverContext.close();

  // Owner approves. The pending queue renders each request as a
  // data-testid="pending-request" card (pending-queue.tsx), not a table row
  // -- getByRole("row", ...) never matches anything there.
  await page.goto("/ayam-norliza-pilot/leave/manage");
  const pendingCard = page.getByTestId("pending-request").filter({ hasText: `roster gap ${stamp}` });
  await expect(pendingCard).toBeVisible({ timeout: 10_000 });
  await pendingCard.getByRole("button", { name: /^approve$/i }).click();
  // Confirming re-uses the same "Approve" label on the note dialog's submit button.
  await page.getByRole("dialog").getByRole("button", { name: /^approve$/i }).click();
  await expect(pendingCard).toBeHidden({ timeout: 10_000 });
  await dismissToasts(page);

  // Roster shows the gap.
  await page.goto("/ayam-norliza-pilot/roster");
  await expect(truckRow.getByRole("button", { name: /no driver/i })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => gapCount(page), { timeout: 15_000 })
    .toBe(baselineGaps + 1);
});
