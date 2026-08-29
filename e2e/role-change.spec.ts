import { test, expect } from "@playwright/test";
import { OWNER, TARGET, signIn, completeReauth } from "./_fixtures";

test("owner changes a member role and sees an audit row", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/users");
  // Target the seeded non-owner member explicitly: row order is not stable
  // (the seed has two owners), and changing an owner's role is rejected as
  // needing a second approver.
  const targetRow = page.locator("table tbody tr", { hasText: TARGET.email });
  const select = targetRow.locator("td select");
  await expect(select).toBeVisible({ timeout: 10_000 });
  // Pick whichever of the two roles the member is not currently in, so the
  // action never short-circuits with "Member already has that role".
  const current = await select.inputValue();
  await select.selectOption(current === "supervisor" ? "driver" : "supervisor");

  // Role changes are a sensitive action: the server returns `reauth_required`
  // and the island mounts the step-up dialog, which must be completed for the
  // change (and its audit event) to actually happen.
  await completeReauth(page, OWNER.password);

  // Re-read the audit log until the event lands.
  await expect
    .poll(
      async () => {
        await page.goto("/ayam-norliza-pilot/settings/audit-log");
        return page.getByText(/identity\.role_changed|identity\.scope_changed/i).count();
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
});
