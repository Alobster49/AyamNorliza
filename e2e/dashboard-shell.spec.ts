import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("dashboard shell exposes sidebar-07 navigation and account actions", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/overview");

  await expect(
    page.getByRole("heading", { name: /command center/i }),
  ).toBeVisible({ timeout: 10_000 });

  const overview = page.getByRole("link", { name: /^overview$/i });
  await expect(overview).toBeVisible();
  await expect(overview).toHaveAttribute("aria-current", "page");

  await expect(page.getByRole("button", { name: /^operations$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^farm setup$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^access control$/i })).toBeVisible();

  const sidebar = page.locator('[data-slot="sidebar"]');
  const openSectionSubmenus = sidebar.locator('[data-sidebar="menu-sub"]');
  await expect(openSectionSubmenus).toHaveCount(3);
  await expect(openSectionSubmenus.first()).toHaveCSS("border-left-style", "solid");

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
