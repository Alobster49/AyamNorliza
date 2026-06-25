import { test, expect, type Page } from "@playwright/test";

/**
 * Resend mock + seeded user fixtures. The seeded owner lives in the
 * `ayam-norliza-pilot` org from migration 04. Tests sign in by going
 * through the real `/login` form; the email server is mocked so the
 * signup confirmation link is auto-followed.
 */

export const OWNER = {
  email: "owner@ayam-norliza-pilot.example",
  password: "test-only-password-12-chars",
};

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

export async function expectOnDashboard(page: Page) {
  await expect(page).toHaveURL(/\/(?:ayam-norliza-pilot|.*)\//);
}
