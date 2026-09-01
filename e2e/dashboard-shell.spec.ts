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
  await expect(page.getByRole("button", { name: /^sales$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^fulfillment$/i })).toBeVisible();

  // Sidebar renders one open submenu per top-level nav group the viewer can
  // see. The owner sees four: Sales, Fulfillment, Access control and HR.
  // System is dropped because its only item needs `data_console.manage`,
  // which owner deliberately does not hold (DEFAULT_ROLE_GRANTS in
  // src/lib/auth/rbac.ts) -- that group is org_admin-only.
  const sidebar = page.locator('[data-slot="sidebar"]');
  const openSectionSubmenus = sidebar.locator('[data-sidebar="menu-sub"]');
  await expect(openSectionSubmenus).toHaveCount(4);

  await expect(page.getByRole("link", { name: /^organization$/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^users$/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^orders$/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^customers$/i })).toBeVisible();

  await page.getByRole("button", { name: /owner@ayam-norliza-pilot\.example/i }).click();
  await expect(page.getByRole("menuitem", { name: /my security/i })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /organization settings/i }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible();

  // Close the account dropdown before the next click — its Radix overlay
  // otherwise intercepts pointer events on the header underneath it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeHidden();

  // Scoped to <header>: the sidebar's resize rail (SidebarRail) also carries
  // aria-label="Toggle Sidebar" for a11y, so an unscoped role lookup matches
  // two elements. The header's SidebarTrigger is the one users actually see.
  await page
    .locator("header")
    .getByRole("button", { name: /toggle sidebar/i })
    .click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
});
