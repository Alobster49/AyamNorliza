import { test, expect } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("owner signs in and sees the dashboard", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  // Signing in lands staff on the products catalog; the standalone
  // overview/"command center" page no longer exists. The products page has
  // no heading of its own (i18n phase 3 dropped the old "Products & Catalog"
  // copy) — assert the sidebar nav marks Products active instead.
  await expect(page).toHaveURL(/\/[^/]+\/products$/);
  await expect(page.getByRole("link", { name: /^products$/i })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The authenticated dashboard shell is present around it.
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();
});

test("invalid credentials show an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill("wrong-password-here");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
