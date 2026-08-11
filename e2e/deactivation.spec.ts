import { test, expect } from "@playwright/test";
import { OWNER, TARGET, signIn, completeReauth, reactivateTarget } from "./_fixtures";

// This spec genuinely suspends the shared seeded member, so restore it
// afterwards — otherwise every later run (and the second Playwright project)
// starts with a member who can no longer sign in.
test.afterEach(reactivateTarget);

test("deactivating a user revokes their session", async ({ page, browser }) => {
  // The target needs its OWN browser context: `context.newPage()` would share
  // one cookie jar with the owner's tab, so signing in as the owner below
  // would silently replace the target's session.
  const targetContext = await browser.newContext();
  const second = await targetContext.newPage();
  await signIn(second, TARGET.email, TARGET.password);
  await expect(second.getByRole("heading", { name: /organization settings/i })).toBeVisible({
    timeout: 10_000,
  });

  // Owner tab: deactivate that specific user (not the owner's own row).
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/users");
  const targetRow = page.locator("table tbody tr", { hasText: TARGET.userId });
  await targetRow.getByRole("button", { name: /deactivate/i }).click();

  // Deactivation is a sensitive action: complete the step-up dialog so the
  // action actually runs (it suspends the member and revokes their sessions).
  await completeReauth(page, OWNER.password);
  await expect(targetRow).toContainText(/suspended/i, { timeout: 10_000 });

  // The deactivated user loses access on their next request.
  await second.reload();
  await expect(second.getByRole("heading", { name: /sign in/i })).toBeVisible({ timeout: 15_000 });

  await targetContext.close();
});
