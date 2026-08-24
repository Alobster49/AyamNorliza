import { expect, test } from "@playwright/test";
import {
  OWNER,
  createSellableProduct,
  seedZoneWithCoverage,
  signIn,
  uniqueFixtureName,
} from "./_fixtures";

test("first-time buyer orders end-to-end with inline account creation, never seeing /login", async ({
  page,
  context,
}) => {
  const productName = uniqueFixtureName("E2E Inline Signup Chicken");
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, productName);
  await seedZoneWithCoverage(
    page,
    uniqueFixtureName("E2E Inline Zone"),
    uniqueFixtureName("E2E Inline Truck"),
    uniqueFixtureName("TRK").slice(0, 20),
  );

  // Fresh anonymous context page — no buyer session.
  const buyerPage = await context.newPage();
  await buyerPage.goto("/ms/buyer_portal/ayam-norliza-pilot/shop");

  // Dismiss the first-visit pricing explainer if it opens (it auto-opens
  // ~600ms after mount — isVisible() does not wait, so use waitFor()).
  const explainer = buyerPage.getByRole("button", { name: "Faham!" });
  try {
    await explainer.waitFor({ state: "visible", timeout: 3000 });
    await explainer.click();
  } catch {
    // Never opened (already seen in this context) - nothing to dismiss.
  }

  const productCard = buyerPage
    .locator('[data-slot="card"]')
    .filter({ hasText: productName });
  await expect(productCard).toBeVisible({ timeout: 10_000 });
  await productCard.getByRole("button", { name: "+ Tambah" }).click();

  const sheet = buyerPage.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("button", { name: "Tambah ke troli" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });

  await buyerPage.goto("/ms/buyer_portal/ayam-norliza-pilot/cart");
  await expect(buyerPage.getByText(productName)).toBeVisible({ timeout: 10_000 });
  await buyerPage.getByRole("button", { name: "Teruskan ke checkout" }).click();
  await expect(buyerPage).toHaveURL(/\/ms\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 10_000,
  });
  // The wall is gone: we are on checkout, not /login.
  expect(buyerPage.url()).not.toContain("/login");

  // Inline account (Akaun baru is the default mode).
  const email = `e2e-inline-${Date.now()}@example.com`;
  await buyerPage.getByLabel("Nama").fill("E2E Pembeli Baru");
  await buyerPage.getByLabel("Nombor telefon").fill("012-345 6789");
  await buyerPage.getByLabel("E-mel").fill(email);
  await buyerPage.getByLabel(/kata laluan/i).fill("passw0rd-e2e");

  // New address (postcode 50000 is covered by the seeded zone). AddressFields
  // itself is unchanged by the redesign — mirror e2e/_fixtures.ts'
  // checkoutWithNewAddress, which goes at the textbox by role (getByLabel
  // also matches the saved-address radiogroup's aria-label once one exists).
  await buyerPage.getByRole("textbox", { name: "Alamat", exact: true }).fill("88 Jalan Inline");
  await buyerPage.getByLabel("Poskod").fill("50000");
  // AddressFields auto-fills state/area from the postcode.

  // Zone chip confirms, then pick the first available slot.
  await expect(buyerPage.getByText(/zon:/i)).toBeVisible({ timeout: 10_000 });
  const dateGroup = buyerPage.getByRole("radiogroup", { name: "Tarikh" });
  await expect(dateGroup).toBeVisible({ timeout: 10_000 });
  const timeGroup = buyerPage.getByRole("radiogroup", { name: "Masa" });
  await timeGroup.getByRole("radio").first().click();

  await buyerPage.getByRole("button", { name: "Hantar pesanan" }).click();

  await expect(buyerPage.getByTestId("order-confirmation")).toBeVisible({ timeout: 15_000 });
  await expect(buyerPage.getByText("Pesanan diterima!")).toBeVisible();
  await buyerPage.getByRole("button", { name: /lihat pesanan saya/i }).click();
  await expect(buyerPage).toHaveURL(/\/ms\/buyer_portal\/ayam-norliza-pilot\/orders/, {
    timeout: 10_000,
  });
  await expect(buyerPage.getByText("Pesanan Saya")).toBeVisible({ timeout: 10_000 });
});
