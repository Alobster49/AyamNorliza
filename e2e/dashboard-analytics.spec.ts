import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

/**
 * Smoke test for the manager landing page (Task 10): owners now land on
 * `/{org}/dashboard` instead of Products, and this page should render its
 * headline analytics. Strings come from `analytics.*` / `dashboard.pages.dashboard`
 * in en.json — keep these locators in sync with that file.
 */
test("owner sees the analytics dashboard with KPIs, range controls, and sidebar entry", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/dashboard");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 10_000,
  });

  // KPI card labels render as plain text inside shadcn CardTitle
  // (`data-slot="card-title"`, not a heading/button/link role), and "Sales"
  // and "Orders" also appear as sidebar nav text - scope to the KPI cards'
  // own data-slot so this doesn't collide with the sidebar in strict mode.
  const kpiLabels = page.locator('[data-slot="card-title"]');
  // Exact match: the revenue chart's card title is "Sales trend", a
  // substring superset of "Sales" that a plain hasText filter would also
  // match.
  await expect(kpiLabels.filter({ hasText: /^Sales$/ })).toBeVisible();
  await expect(kpiLabels.filter({ hasText: /^Orders$/ })).toBeVisible();
  await expect(kpiLabels.filter({ hasText: /^Kg sold$/ })).toBeVisible();

  // Range presets are real <button>s (RangePicker), so role-based lookups
  // are unambiguous.
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "7 days" })).toBeVisible();
  await expect(page.getByRole("button", { name: "30 days" })).toBeVisible();
  await expect(page.getByRole("button", { name: "90 days" })).toBeVisible();

  // Sidebar: "Dashboard" is the first item in the "Sales" group (see
  // dashboard-shell-model.ts). Scope to the group carrying the "Sales"
  // label, then check its first nav link.
  const sidebar = page.locator('[data-slot="sidebar"]');
  const salesGroup = sidebar
    .locator('[data-sidebar="group"]')
    .filter({
      has: page.locator('[data-sidebar="group-label"]', { hasText: /^sales$/i }),
    });
  await expect(salesGroup.getByRole("link").first()).toHaveText("Dashboard");
});
