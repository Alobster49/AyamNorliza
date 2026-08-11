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

/** Seeded non-owner member (see 20260624000004_id_access_seed.sql). */
export const TARGET = {
  email: "target@ayam-norliza-pilot.example",
  password: "test-only-password-12-chars",
  userId: "10000000-0000-0000-0000-000000000002",
};

/**
 * Restore the seeded target member after a test suspends them, so the suite
 * stays re-runnable without a database reset. Uses the service-role key that
 * the e2e runbook exports; skips (loudly) if it is not configured.
 */
export async function reactivateTarget() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn("reactivateTarget: SUPABASE_SERVICE_ROLE_KEY not set; leaving member suspended");
    return;
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  await fetch(`${url}/rest/v1/organization_members?user_id=eq.${TARGET.userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "active" }),
  });
  await fetch(`${url}/rest/v1/profiles?user_id=eq.${TARGET.userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "active" }),
  });
  // Deactivation also bans the auth user (adminRevokeUserSessions), which
  // blocks sign-in until it expires — lift it too.
  await fetch(`${url}/auth/v1/admin/users/${TARGET.userId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ban_duration: "none" }),
  });
}

/**
 * Complete the step-up ("Confirm it's you") dialog that sensitive Server
 * Actions trigger via `reauth_required`. The dialog re-runs the pending
 * action on success, so callers can assert its effects afterwards.
 */
export async function completeReauth(page: Page, password: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/password/i).fill(password);
  await dialog.getByRole("button", { name: /confirm/i }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
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
