import { test, expect, type Page } from "@playwright/test";

/**
 * Resend mock + owner fixtures. Tests sign in by going through the real
 * `/login` form; set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD when running
 * against a non-local Supabase project.
 */

export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner@ayam-norliza-pilot.example",
  password: process.env.E2E_OWNER_PASSWORD ?? "test-only-password-12-chars",
};

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/(?:[^/]+\/settings\/organization|signup)(?:[/?#]|$)/, { timeout: 10_000 });
}

export const BUYER = {
  email: process.env.E2E_BUYER_EMAIL ?? "buyer@ayam-norliza-pilot.example",
  password: process.env.E2E_BUYER_PASSWORD ?? "test-only-password-12-chars",
};

export async function signInBuyer(page: Page, email: string, password: string) {
  await page.goto("/buyer_portal/ayam-norliza-pilot/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, { timeout: 10_000 });
}

export async function expectOnDashboard(page: Page) {
  await expect(page).toHaveURL(/\/(?:ayam-norliza-pilot|.*)\//);
}
