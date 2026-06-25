import { test, expect } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("owner changes a member role and sees an audit row", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/users");
  // Find a role select on a non-owner member and change it.
  const select = page.locator("table tbody tr td select").first();
  await expect(select).toBeVisible({ timeout: 10_000 });
  await select.selectOption("caretaker");
  // The action triggers `reauth_required`; we rely on the seeded reauth
  // proof for tests. The dialog should not appear when the proof is
  // valid; otherwise it appears and we cancel.
  const reauthDialog = page.getByRole("dialog");
  if (await reauthDialog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /cancel/i }).click();
  }
  // Visit the audit log to confirm the event was recorded.
  await page.goto("/ayam-norliza-pilot/settings/audit-log");
  await expect(page.getByText(/identity\.role_changed|identity\.scope_changed/i).first()).toBeVisible({ timeout: 5_000 });
});
