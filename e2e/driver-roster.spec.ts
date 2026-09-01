import { test, expect, type Page } from "@playwright/test";
import { OWNER, TARGET, dismissToasts, seedZoneWithCoverage, signIn } from "./_fixtures";

/**
 * Read the roster's "N gaps" alert pill. The pilot org's base fixtures
 * (TRK-A, TRK-B, both with no regular driver) already put the roster in a
 * many-gaps state on a bare `db:reset`, so this spec can't assert a literal
 * "1 gap" -- it reads the count before and after its own truck's leave is
 * approved and asserts it went up by exactly one instead. `AlertPill`
 * renders nothing at all when there are zero gaps and zero risks, so an
 * absent pill reads as 0.
 */
async function gapCount(page: Page): Promise<number> {
  const pill = page.getByTestId("roster-gap-count");
  if ((await pill.count()) === 0) return 0;
  const text = await pill.innerText();
  return Number(/(\d+)\s*gap/.exec(text)?.[1] ?? "0");
}

/**
 * Owner makes TARGET the regular driver of a fresh truck, TARGET applies
 * emergency leave for tomorrow (the only weekday that truck has a slot on),
 * owner approves, and the roster shows the truck as "No driver" tomorrow.
 * Emergency leave is upon-request with no advance-notice rule, so tomorrow
 * is a legal date (annual leave would need 7 days' notice).
 */
test("approved driver leave surfaces as a truck gap on the roster", async ({ page, browser }) => {
  test.setTimeout(150_000);
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

  // Regular driver = TARGET.
  await page.goto("/ayam-norliza-pilot/roster");
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
  const truckRow = page.getByTestId(`roster-truck-row-${truckCode}`);
  await expect(truckRow.getByRole("button", { name: /no driver/i })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => gapCount(page), { timeout: 15_000 })
    .toBe(baselineGaps + 1);
});
