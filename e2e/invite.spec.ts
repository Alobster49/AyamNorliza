import { test, expect } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("owner signs in and sees the dashboard", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await expect(page.getByRole("heading", { name: /command center/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Operational readiness/i)).toBeVisible();
});

test("invalid credentials show an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill("wrong-password-here");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
