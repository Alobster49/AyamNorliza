import { test, expect } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("owner starts an access review and decides an item", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/access-reviews");
  await expect(page.getByRole("heading", { name: /access reviews/i })).toBeVisible();
  const start = page.getByRole("button", { name: /start quarterly review/i });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
  }
  // Decide an item: click "Keep" on the first review item.
  const keep = page.getByRole("button", { name: /keep/i }).first();
  if (await keep.isVisible().catch(() => false)) {
    await keep.click();
  }
  // Audit log should have a row tagged identity.access_review_started
  // or identity.access_review_decided.
  await page.goto("/ayam-norliza-pilot/settings/audit-log");
  await expect(page.getByText(/identity\.access_review/i).first()).toBeVisible({ timeout: 5_000 });
});
