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
  await buyerPage.getByRole("button", { name: "Sign up" }).click();
  await buyerPage.getByLabel("Your Name").fill(buyerName);
  await buyerPage.getByLabel("Email").fill(buyerEmail);
  await buyerPage.getByLabel("Phone (for WhatsApp)").fill("012-345 6789");
  await buyerPage.getByLabel("Password", { exact: true }).fill(buyerPassword);
  await buyerPage.getByLabel("Confirm Password").fill(buyerPassword);
  await buyerPage.getByRole("button", { name: "Create Account" }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, {
    timeout: 20_000,
  });

  // Step 3: add the seeded product to cart and go to checkout.
  async function addProductToCart() {
    const productCard = buyerPage
      .locator('[data-slot="card"]')
      .filter({ hasText: productName });
    await expect(productCard).toBeVisible({ timeout: 20_000 });
    await productCard.getByRole("button", { name: /add to cart/i }).click();

    const addToCartDialog = buyerPage.getByRole("dialog");
    await expect(addToCartDialog).toBeVisible({ timeout: 20_000 });
    await addToCartDialog.getByRole("button", { name: "Piece", exact: true }).click();
    await addToCartDialog.getByLabel(/quantity/i).fill("2");
    await addToCartDialog.getByLabel(/min size/i).fill("1.2");
    await addToCartDialog.getByLabel(/max size/i).fill("1.5");
    await addToCartDialog.getByLabel(/can.t get this size/i).click();
    await buyerPage.getByRole("option", { name: "Bigger is ok" }).click();
    await addToCartDialog.getByRole("button", { name: "Add to cart" }).click();
    await expect(addToCartDialog).toBeHidden({ timeout: 20_000 });
  }

  await addProductToCart();
  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
  await buyerPage.getByRole("button", { name: /proceed to checkout/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 20_000,
  });

  // Step 4: fill the new-address form (buyer has no saved addresses yet, so
  // it renders directly — no address radiogroup, no zone dropdown).
  await expect(buyerPage.getByLabel("Delivery Zone")).toHaveCount(0);
  await buyerPage.getByLabel("Address").fill("12 Jalan E2E");
  await buyerPage.getByLabel("Postcode").fill("50000");

  // Postcode lookup auto-fills State/Area client-side (dataset spelling:
  // state carries the "Wp" prefix, area does not).
  await expect(buyerPage.getByRole("combobox", { name: "State" })).toContainText(
    "Wp Kuala Lumpur",
    { timeout: 20_000 },
  );
  await expect(buyerPage.getByRole("combobox", { name: "Area" })).toContainText(
    "Kuala Lumpur",
    { timeout: 20_000 },
  );
  await expect(buyerPage.getByLabel("Delivery Zone")).toHaveCount(0);

  // Step 5: pick a slot (zone resolves server-side from the postcode) and
  // place the order.
  const slotGroup = buyerPage.getByRole("radiogroup", { name: "Delivery slot" });
  const firstSlot = slotGroup.getByRole("radio").first();
  await expect(firstSlot).toBeVisible({ timeout: 25_000 });
  await firstSlot.click();
  await buyerPage.getByRole("button", { name: "Place Order" }).click();
  // RECONCILIATION: "Order Placed!" (exact) also collides with the lowercase
  // toast title ("Order placed!") and its aria-live announcement span
  // ("Notification Order placed!...") without an exact match.
  await expect(buyerPage.getByText("Order Placed!", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // Step 6: return to checkout with a new cart item — the address just
  // placed the order with should now be a saved, preselected radio option,
  // and delivery slots should load without any manual zone/postcode entry.
  await buyerPage.getByRole("button", { name: /continue shopping/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, {
    timeout: 20_000,
  });
  await addProductToCart();
  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/checkout");

  const addressGroup = buyerPage.getByRole("radiogroup", { name: "Delivery address" });
  const savedAddressRadio = addressGroup.getByRole("radio", { name: /12 Jalan E2E/ });
  await expect(savedAddressRadio).toBeVisible({ timeout: 20_000 });
  await expect(savedAddressRadio).toHaveAttribute("aria-checked", "true");

  const slotGroup2 = buyerPage.getByRole("radiogroup", { name: "Delivery slot" });
  await expect(slotGroup2.getByRole("radio").first()).toBeVisible({ timeout: 25_000 });

  // Step 7: signed-out gate — a fresh, unauthenticated context hitting
  // checkout directly gets server-redirected to login with a `next` param.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto("/buyer_portal/ayam-norliza-pilot/checkout");
  await expect(guestPage).toHaveURL(/\/login\?next=/, { timeout: 20_000 });
  await guestContext.close();

  await buyerContext.close();
});
