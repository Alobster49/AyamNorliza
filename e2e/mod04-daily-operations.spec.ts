import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test.skip(!process.env.E2E_OWNER_EMAIL || !process.env.E2E_OWNER_PASSWORD, "Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run MOD-04 browser coverage.");

test("owner can open daily operations routes and resolve manual scan entry", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);

  await page.goto("/ayam-norliza-pilot/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "House rounds" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Resolve/i })).toBeVisible();

  await page.goto("/ayam-norliza-pilot/rounds");
  await expect(page.getByRole("heading", { name: "Rounds" })).toBeVisible();
  await expect(page.getByText("Recent inspections")).toBeVisible();

  await page.goto("/ayam-norliza-pilot/exceptions/daily-records");
  await expect(page.getByRole("heading", { name: "Daily record exceptions" })).toBeVisible();

  await page.goto("/ayam-norliza-pilot/period-close");
  await expect(page.getByRole("heading", { name: "Period close" })).toBeVisible();
});
