import { test, expect } from "@playwright/test";
import { OWNER, signIn, uniqueFixtureName } from "./_fixtures";

// A unique valid Malaysian mobile per run so reruns never collide on the
// phone-match trigger: "01" + 8 digits = 10 digits, passes normalizeMalaysianMobile.
function uniquePhone(): string {
  return "01" + String(Date.now()).slice(-8);
}

test("buyer signup auto-links to the admin-created customer with the same phone", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  const customerName = uniqueFixtureName("E2E Sync Cafe");
  const buyerName = uniqueFixtureName("E2E Sync Buyer");
  const phone = uniquePhone();
  const dashedPhone = `${phone.slice(0, 3)}-${phone.slice(3)}`; // admin types it dashed
  const buyerEmail = `e2e-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const buyerPassword = "test-only-password-12-chars";

  // Step 1: admin creates the customer (dashed phone, no email).
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/customers");
  await page.getByRole("button", { name: "Add Customer" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *").fill(customerName);
  await dialog.getByLabel("Phone *").fill(dashedPhone);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(
    page.getByRole("row").filter({ hasText: customerName })
  ).toBeVisible({ timeout: 20_000 });

  // Step 2: buyer signs up in a fresh context (true anon path — see
  // e2e/buyer-address.spec.ts for why a shared context would mask bugs)
  // with the E.164-normalizable bare form of the same phone.
  const buyerContext = await browser.newContext();
  const buyerPage = await buyerContext.newPage();
  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/login");
  await buyerPage.getByRole("radio", { name: "Daftar" }).click();
  await buyerPage.getByLabel("Nama").fill(buyerName);
  await buyerPage.getByLabel("Email").fill(buyerEmail);
  await buyerPage.getByLabel("Nombor telefon").fill(phone);
  await buyerPage.getByLabel("Kata laluan", { exact: true }).fill(buyerPassword);
  await buyerPage.getByLabel("Sahkan kata laluan").fill(buyerPassword);
  await buyerPage.getByRole("button", { name: "Daftar", exact: true }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, {
    timeout: 20_000,
  });
  await buyerContext.close();

  // Step 3: the admin's list shows ONE linked row, not a duplicate.
  await page.goto("/ayam-norliza-pilot/customers");
  const linkedRow = page.getByRole("row").filter({ hasText: customerName });
  await expect(linkedRow).toHaveCount(1, { timeout: 20_000 });
  await expect(linkedRow.getByText("Portal")).toBeVisible();
  await expect(linkedRow.getByText(buyerEmail)).toBeVisible();
  // No second row named after the buyer account.
  await expect(page.getByRole("row").filter({ hasText: buyerName })).toHaveCount(0);
});
