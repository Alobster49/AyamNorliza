import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("dashboard shell exposes sidebar navigation and account actions", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/organization");

  await expect(
    page.getByRole("heading", { name: /organization/i }),
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole("button", { name: /^access control$/i })).toBeVisible();

  const sidebar = page.locator('[data-slot="sidebar"]');
  const openSectionSubmenus = sidebar.locator('[data-sidebar="menu-sub"]');
  await expect(openSectionSubmenus).toHaveCount(1);

  await expect(page.getByRole("link", { name: /^organization$/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^users$/i })).toBeVisible();

  await page.getByRole("button", { name: /owner@ayam-norliza-pilot\.example/i }).click();
  await expect(page.getByRole("menuitem", { name: /my security/i })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /organization settings/i }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible();

  await page.getByRole("button", { name: /toggle sidebar/i }).click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
});
