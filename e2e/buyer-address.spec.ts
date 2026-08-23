import { expect, test } from "@playwright/test";
import {
  OWNER,
  createSellableProduct,
  seedZoneWithCoverage,
  signIn,
  uniqueFixtureName,
} from "./_fixtures";

test("buyer signs up with phone, checks out with a new address, then reuses it from the address book", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  const productName = uniqueFixtureName("E2E Address Chicken");
  const zoneName = uniqueFixtureName("E2E Addr Zone");
  const truckName = uniqueFixtureName("E2E Addr Truck");
  const truckCode = uniqueFixtureName("TRK").slice(0, 20);

  // Step 1: seed as OWNER — sellable product + zone/truck/slot/postcode coverage.
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, productName);
  await seedZoneWithCoverage(page, zoneName, truckName, truckCode);

  // Step 2: sign up as a fresh buyer in its own browser context — NOT
  // `context.newPage()` off the owner's context. A shared context would
  // carry the owner's session cookie into the buyer tab, so Supabase would
  // treat the org lookup and signup as the `authenticated` role instead of
  // `anon`, masking the real anonymous-visitor path entirely (this is
  // exactly the gap that let two now-fixed anon-permission bugs go
  // uncaught). A fresh context has no cookies at all, so this exercises the
  // true production path a first-time customer hits.
  const buyerContext = await browser.newContext();
  const buyerPage = await buyerContext.newPage();
  const buyerEmail = `e2e-addr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const buyerName = uniqueFixtureName("E2E Addr Buyer");
  const buyerPassword = "test-only-password-12-chars";

  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/login");
  // RECONCILIATION: the login/signup toggle is a radiogroup ("Log
  // masuk"/"Daftar" radios), not a "Sign up" button, and the submit button
  // reads "Daftar" (was "Create Account").
  await buyerPage.getByRole("radio", { name: "Daftar" }).click();
  await buyerPage.getByLabel("Your Name").fill(buyerName);
  await buyerPage.getByLabel("Email").fill(buyerEmail);
  await buyerPage.getByLabel("Phone (for WhatsApp)").fill("012-345 6789");
  await buyerPage.getByLabel("Password", { exact: true }).fill(buyerPassword);
  await buyerPage.getByLabel("Confirm Password").fill(buyerPassword);
  await buyerPage.getByRole("button", { name: "Daftar" }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, {
    timeout: 20_000,
  });

  // Fresh browser context, so the first /shop visit can auto-open the
  // pricing explainer sheet (~600ms after mount); dismiss it before any card
  // interaction. isVisible() does not wait, so use waitFor() instead.
  const explainer = buyerPage.getByRole("button", { name: "Faham!" });
  try {
    await explainer.waitFor({ state: "visible", timeout: 3000 });
    await explainer.click();
  } catch {
    // Never opened (already seen in this context) - nothing to dismiss.
  }

  // Step 3: add the seeded product to cart and go to checkout.
  async function addProductToCart() {
    const productCard = buyerPage
      .locator('[data-slot="card"]')
      .filter({ hasText: productName });
    await expect(productCard).toBeVisible({ timeout: 20_000 });
    await productCard.getByRole("button", { name: "+ Tambah" }).click();

    const addToCartDialog = buyerPage.getByRole("dialog");
    await expect(addToCartDialog).toBeVisible({ timeout: 20_000 });
    await addToCartDialog.getByRole("radio", { name: "Ekor", exact: true }).click();
    // RECONCILIATION: getByLabel(/kuantiti/i) is ambiguous - it also matches
    // the "+" stepper button's aria-label ("Tambah kuantiti"). Go at the
    // number input by its spinbutton role instead.
    await addToCartDialog.getByRole("spinbutton", { name: /kuantiti/i }).fill("2");
    await addToCartDialog.getByLabel(/saiz min/i).fill("1.2");
    await addToCartDialog.getByLabel(/saiz maks/i).fill("1.5");
    await addToCartDialog.getByRole("radio", { name: "Besar pun ok" }).click();
    await addToCartDialog.getByRole("button", { name: "Tambah ke troli" }).click();
    await expect(addToCartDialog).toBeHidden({ timeout: 20_000 });
  }

  await addProductToCart();
  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
  await buyerPage.getByRole("button", { name: "Teruskan ke checkout" }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 20_000,
  });

  // Step 4: fill the new-address form (buyer has no saved addresses yet, so
  // it renders directly — no address radiogroup, no zone dropdown).
  await expect(buyerPage.getByText(/memuatkan alamat anda/i)).toHaveCount(0, { timeout: 20_000 });
  await expect(buyerPage.getByRole("radiogroup", { name: "Alamat penghantaran" })).toHaveCount(0);
  await buyerPage.getByRole("textbox", { name: "Address" }).fill("12 Jalan E2E");
  await buyerPage.getByLabel("Postcode").fill("50000");

  // Postcode lookup auto-fills State/Area client-side (dataset spelling:
  // state carries the "Wp" prefix, area does not). AddressFields itself is
  // unchanged by the buyer redesign.
  await expect(buyerPage.getByRole("combobox", { name: "State" })).toContainText(
    "Wp Kuala Lumpur",
    { timeout: 20_000 },
  );
  await expect(buyerPage.getByRole("combobox", { name: "Area" })).toContainText(
    "Kuala Lumpur",
    { timeout: 20_000 },
  );
  await expect(buyerPage.getByRole("radiogroup", { name: "Alamat penghantaran" })).toHaveCount(0);

  // Step 5: pick a slot (zone resolves server-side from the postcode) and
  // place the order. RECONCILIATION: the single "Delivery slot" radiogroup
  // was split into a "Tarikh" (date) pill row and a "Masa" (time)
  // radiogroup; the first date is preselected, so only the time radio needs
  // a click.
  const timeGroup = buyerPage.getByRole("radiogroup", { name: "Masa" });
  const firstSlot = timeGroup.getByRole("radio").first();
  await expect(firstSlot).toBeVisible({ timeout: 25_000 });
  await firstSlot.click();
  await buyerPage.getByRole("button", { name: "Hantar pesanan" }).click();
  // RECONCILIATION: placeOrder swaps in an inline confirmation card
  // (data-testid "order-confirmation", "Pesanan diterima!") instead of
  // navigating away or showing an "Order Placed!" toast.
  await expect(buyerPage.getByTestId("order-confirmation")).toBeVisible({ timeout: 20_000 });
  await expect(buyerPage.getByText("Pesanan diterima!")).toBeVisible();

  // Step 6: return to checkout with a new cart item — the address just
  // placed the order with should now be a saved, preselected radio option,
  // and delivery slots should load without any manual zone/postcode entry.
  await buyerPage.getByRole("button", { name: "Terus beli lagi" }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, {
    timeout: 20_000,
  });
  await addProductToCart();
  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/checkout");

  const addressGroup = buyerPage.getByRole("radiogroup", { name: "Alamat penghantaran" });
  const savedAddressRadio = addressGroup.getByRole("radio", { name: /12 Jalan E2E/ });
  await expect(savedAddressRadio).toBeVisible({ timeout: 20_000 });
  await expect(savedAddressRadio).toHaveAttribute("aria-checked", "true");

  const timeGroup2 = buyerPage.getByRole("radiogroup", { name: "Masa" });
  await expect(timeGroup2.getByRole("radio").first()).toBeVisible({ timeout: 25_000 });

  // Step 7: anonymous checkout no longer has a login wall — a fresh,
  // unauthenticated context hitting checkout directly stays on /checkout
  // (its empty cart shows the same empty-cart state the shop's cart view
  // does; account creation happens inline once there is something to buy).
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto("/buyer_portal/ayam-norliza-pilot/checkout");
  await expect(guestPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 20_000,
  });
  expect(guestPage.url()).not.toContain("/login");
  await expect(guestPage.getByText(/troli kosong/i)).toBeVisible({ timeout: 10_000 });
  await guestContext.close();

  await buyerContext.close();
});
