import { test, expect } from "@playwright/test";
import { OWNER, TARGET, signIn, completeReauth, reactivateTarget } from "./_fixtures";

// This spec genuinely suspends (and bans) the shared seeded member. Restore
// it both before and after: after, so later runs and the second Playwright
// project aren't left with a member who cannot sign in; before, so this test
// starts from a known-good state no matter what ran previously.
test.beforeEach(reactivateTarget);
test.afterEach(reactivateTarget);

test("deactivating a user revokes their session", async ({ page, browser }) => {
  // The target needs its OWN browser context: `context.newPage()` would share
  // one cookie jar with the owner's tab, so signing in as the owner below
  // would silently replace the target's session.
  const targetContext = await browser.newContext();
  const second = await targetContext.newPage();
  await signIn(second, TARGET.email, TARGET.password);
  // Assert only that the session exists, not which page it landed on: the
  // seeded target is a `driver` (7c4fb01 realigned it from `caretaker`), so
  // it lands on the driver deck, and any future role change would move that
  // landing again. This is the exact inverse of the post-deactivation
  // assertion below, so it still catches a sign-in that never happened.
  await expect(second.getByRole("heading", { name: /sign in/i })).toBeHidden({
    timeout: 10_000,
  });

  // Owner tab: deactivate that specific user (not the owner's own row).
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/users");
  const targetRow = page.locator("table tbody tr", { hasText: TARGET.email });
  await targetRow.getByRole("button", { name: /deactivate/i }).click();

  // Deactivation is a sensitive action: complete the step-up dialog so the
  // action actually runs (it suspends the member and revokes their sessions).
  await completeReauth(page, OWNER.password);
  // Assert the persisted state rather than the dialog's optimistic refresh,
  // re-reading the page until the suspension lands.
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.locator("table tbody tr", { hasText: TARGET.email }).innerText();
      },
      { timeout: 20_000 },
    )
    .toMatch(/suspended/i);

  // The deactivated user loses access on their next request.
  await second.reload();
  await expect(second.getByRole("heading", { name: /sign in/i })).toBeVisible({ timeout: 15_000 });

  await targetContext.close();
});
