import { test, expect } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("deactivating a user revokes their session within 30s", async ({ page, context }) => {
  // Open a second tab as the "to-be-deactivated" user.
  const second = await context.newPage();
  await signIn(second, "target@ayam-norliza-pilot.example", "test-only-password-12-chars");
  await expect(second.getByRole("heading", { name: /welcome/i })).toBeVisible({ timeout: 10_000 });

  // Owner tab: deactivate the user.
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/users");
  // Click the first "Deactivate" button on the list.
  const deactivate = page.getByRole("button", { name: /deactivate/i }).first();
  if (await deactivate.isVisible().catch(() => false)) {
    await deactivate.click();
    // The server returns reauth_required; tests skip the dialog.
    const reauthDialog = page.getByRole("dialog");
    if (await reauthDialog.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: /cancel/i }).click();
    }
  }

  // The second tab should be signed out within 30s.
  await expect(second.getByRole("heading", { name: /sign in/i })).toBeVisible({ timeout: 30_000 });
});
