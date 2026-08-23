import { expect, test, type Page } from "@playwright/test";
import {
  OWNER,
  BUYER,
  checkoutWithNewAddress,
  createSellableProduct,
  seedZoneWithCoverage,
  signIn,
  signInBuyer,
  uniqueFixtureName,
} from "./_fixtures";

/**
 * Dismiss the first-visit pricing explainer sheet if it auto-opens. Each
 * test gets a fresh browser `context`, so the buyer tab's first visit to
 * /shop can trigger it even for a buyer signing in with an existing account.
 */
async function dismissExplainerIfOpen(page: Page) {
  // It auto-opens ~600ms after mount - isVisible() does not wait, so use
  // waitFor() to give it a real chance to appear before giving up.
  const explainer = page.getByRole("button", { name: "Faham!" });
  try {
    await explainer.waitFor({ state: "visible", timeout: 3000 });
    await explainer.click();
  } catch {
    // Never opened (already seen in this context) - nothing to dismiss.
  }
}

test("buyer adds a product with a size range and fallback, checks out, and sees the order tracked as Ditempah", async ({
  page,
  context,
}) => {
  // Seed a sellable product as the owner in the main tab.
  const productName = uniqueFixtureName("E2E Buyer Portal Chicken");
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, productName);
  // Checkout resolves the zone from the postcode, so the org needs a zone
  // covering 50000 with a slot on tomorrow's weekday.
  await seedZoneWithCoverage(
    page,
    uniqueFixtureName("E2E Buyer Zone"),
    uniqueFixtureName("E2E Buyer Truck"),
    uniqueFixtureName("TRK").slice(0, 20),
  );

  // Shop as the buyer in a second tab (same pattern as e2e/deactivation.spec.ts).
  const buyerPage = await context.newPage();
  await signInBuyer(buyerPage, BUYER.email, BUYER.password);
  await dismissExplainerIfOpen(buyerPage);

  const productCard = buyerPage
    .locator('[data-slot="card"]')
    .filter({ hasText: productName });
  await expect(productCard).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the card trigger reads "+ Tambah" (was "Add to Cart"),
  // and opens a BuyerSheet, which sets role="dialog".
  await productCard.getByRole("button", { name: "+ Tambah" }).click();

  const sheet = buyerPage.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: "Beli ikut" is a radiogroup of "Ekor"/"Kg" radios now
  // (was a pair of plain toggle Buttons labelled "Piece"/"Kg").
  await sheet.getByRole("radio", { name: "Kg", exact: true }).click();
  // RECONCILIATION: the quantity/size labels are BM now — "Kuantiti
  // (ekor)"/"Kuantiti (kg)", "Saiz min (kg/ekor)", "Saiz maks (kg/ekor)".
  // RECONCILIATION: getByLabel(/kuantiti/i) is ambiguous - it also matches
  // the "+" stepper button's aria-label ("Tambah kuantiti"). Go at the
  // number input by its spinbutton role instead.
  await sheet.getByRole("spinbutton", { name: /kuantiti/i }).fill("2.5");
  await sheet.getByLabel(/saiz min/i).fill("1.3");
  await sheet.getByLabel(/saiz maks/i).fill("1.6");
  // RECONCILIATION: "Kalau saiz tak ada?" is a radiogroup of visible radio
  // buttons now (was a shadcn Select opening a separate options popup).
  await sheet.getByRole("radio", { name: "Besar pun ok" }).click();
  await sheet.getByRole("button", { name: "Tambah ke troli" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });

  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
  await expect(buyerPage.getByText(productName)).toBeVisible({ timeout: 10_000 });
  await buyerPage.getByRole("button", { name: "Teruskan ke checkout" }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 10_000,
  });

  // RECONCILIATION: checkout no longer asks for a zone - the buyer types an
  // address + postcode and the zone is resolved server-side from it.
  await checkoutWithNewAddress(buyerPage, "77 Jalan Pembeli");
  await buyerPage.getByRole("button", { name: "Hantar pesanan" }).click();

  // RECONCILIATION: placeOrder doesn't redirect to /orders. It stays on
  // /checkout and swaps in an inline confirmation card (data-testid
  // "order-confirmation", "Pesanan diterima!") with its own "Lihat pesanan
  // saya" button, which must be clicked to navigate.
  await expect(buyerPage.getByTestId("order-confirmation")).toBeVisible({ timeout: 15_000 });
  await expect(buyerPage.getByText("Pesanan diterima!")).toBeVisible();
  await buyerPage.getByRole("button", { name: /lihat pesanan saya/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/orders/, {
    timeout: 10_000,
  });
  // RECONCILIATION: the buyer orders list no longer shows a "Pending" badge
  // for a live order - it renders an OrderTracker whose first (current) step
  // reads "Ditempah".
  await expect(buyerPage.getByText("Ditempah").first()).toBeVisible({ timeout: 10_000 });
});

test("buyer cancels a pending order", async ({ page, context }) => {
  const productName = uniqueFixtureName("E2E Buyer Cancel Chicken");
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, productName);
  // Checkout resolves the zone from the postcode, so the org needs a zone
  // covering 50000 with a slot on tomorrow's weekday.
  await seedZoneWithCoverage(
    page,
    uniqueFixtureName("E2E Buyer Zone"),
    uniqueFixtureName("E2E Buyer Truck"),
    uniqueFixtureName("TRK").slice(0, 20),
  );

  const buyerPage = await context.newPage();
  await signInBuyer(buyerPage, BUYER.email, BUYER.password);
  await dismissExplainerIfOpen(buyerPage);

  const productCard = buyerPage
    .locator('[data-slot="card"]')
    .filter({ hasText: productName });
  await expect(productCard).toBeVisible({ timeout: 10_000 });
  await productCard.getByRole("button", { name: "+ Tambah" }).click();

  const sheet = buyerPage.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("radio", { name: "Ekor", exact: true }).click();
  await sheet.getByRole("spinbutton", { name: /kuantiti/i }).fill("2");
  await sheet.getByLabel(/saiz min/i).fill("1.2");
  await sheet.getByLabel(/saiz maks/i).fill("1.5");
  await sheet.getByRole("radio", { name: "Batal pesanan saya" }).click();
  await sheet.getByRole("button", { name: "Tambah ke troli" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });

  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
  await buyerPage.getByRole("button", { name: "Teruskan ke checkout" }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 10_000,
  });

  await checkoutWithNewAddress(buyerPage, "21 Jalan Batal");
  await buyerPage.getByRole("button", { name: "Hantar pesanan" }).click();
  await expect(buyerPage.getByTestId("order-confirmation")).toBeVisible({ timeout: 15_000 });
  await expect(buyerPage.getByText("Pesanan diterima!")).toBeVisible();
  await buyerPage.getByRole("button", { name: /lihat pesanan saya/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/orders/, {
    timeout: 10_000,
  });

  // getMyOrders sorts newest first, so the order just placed is the first
  // card — there may be an older order from the previous test for the same
  // seeded buyer account still sitting in the list.
  await buyerPage.getByRole("link", { name: /lihat butiran/i }).first().click();
  await expect(buyerPage.getByRole("heading", { name: /butiran pesanan/i })).toBeVisible({
    timeout: 10_000,
  });
  // RECONCILIATION: "Cancel order" only opens a confirmation dialog; the
  // actual cancellation needs a second click on the destructive "Cancel
  // order" button inside that dialog. This part of the order-detail page is
  // unchanged by the buyer redesign.
  await buyerPage.getByRole("button", { name: /cancel order/i }).click();
  const cancelDialog = buyerPage.getByRole("dialog");
  await expect(cancelDialog).toBeVisible({ timeout: 10_000 });
  await cancelDialog.getByRole("button", { name: /cancel order/i }).click();

  // RECONCILIATION: the order detail page also renders status as a plain
  // <span>, not the shadcn Badge component.
  await expect(buyerPage.getByText("Cancelled").first()).toBeVisible({ timeout: 10_000 });
});
