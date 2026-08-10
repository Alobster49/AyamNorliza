import { expect, test, type Page } from "@playwright/test";
import { OWNER, BUYER, signIn, signInBuyer } from "./_fixtures";

async function createSellableProduct(page: Page, productName: string) {
  await page.goto("/ayam-norliza-pilot/products");
  await page.getByRole("button", { name: "Add Category" }).click();
  await page.getByLabel("Category Name").fill(`${productName} Category`);
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

  await page.getByRole("button", { name: "Add Product" }).click();
  await page.getByLabel("Product Name").fill(productName);
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: `${productName} Category` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

  // RECONCILIATION: "Add Size/Option" is rendered once per product card, so
  // once more than one product exists in the org (true across a full suite
  // run against a persisted DB, workers: 1) the bare role query is
  // ambiguous. Scope to the card for the product just created.
  const card = page.locator('[data-slot="card"]').filter({ hasText: productName });
  await card.getByRole("button", { name: "Add Size/Option" }).click();
  await page.getByLabel(/name \(e\.g\., standard/i).fill("Standard");
  await page.getByLabel(/price/i).fill("15.00");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
}

test("buyer adds a product with a size range and fallback, checks out, and sees the order as Pending", async ({
  page,
  context,
}) => {
  // Seed a sellable product as the owner in the main tab.
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, "E2E Buyer Portal Chicken");

  // Shop as the buyer in a second tab (same pattern as e2e/deactivation.spec.ts).
  const buyerPage = await context.newPage();
  await signInBuyer(buyerPage, BUYER.email, BUYER.password);

  const productCard = buyerPage
    .locator('[data-slot="card"]')
    .filter({ hasText: "E2E Buyer Portal Chicken" });
  await expect(productCard).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the dialog trigger reads "Add to Cart" (title case);
  // brief's /add to cart/i already matches this case-insensitively.
  await productCard.getByRole("button", { name: /add to cart/i }).click();

  const addToCartDialog = buyerPage.getByRole("dialog");
  await expect(addToCartDialog).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: "Order by" is a pair of plain toggle Buttons ("Piece" /
  // "Kg"), not radio inputs.
  await addToCartDialog.getByRole("button", { name: "Kg", exact: true }).click();
  // RECONCILIATION: the quantity/size labels include the unit and vary by
  // mode — "Quantity (kg)"/"Quantity (birds)", "Min size (kg/bird)", "Max
  // size (kg/bird)" — not the bare "Quantity"/"Min size (kg)"/"Max size
  // (kg)" the brief assumed. These *do* have htmlFor, so getByLabel works
  // once the regex matches the real copy.
  await addToCartDialog.getByLabel(/quantity/i).fill("2.5");
  await addToCartDialog.getByLabel(/min size/i).fill("1.3");
  await addToCartDialog.getByLabel(/max size/i).fill("1.6");
  // RECONCILIATION: "Can't get this size?" is a shadcn Select, not a radio
  // group; it's properly labeled via htmlFor so getByLabel works.
  await addToCartDialog.getByLabel(/can.t get this size/i).click();
  await buyerPage.getByRole("option", { name: "Bigger is ok" }).click();
  await addToCartDialog.getByRole("button", { name: "Add to cart" }).click();
  await expect(addToCartDialog).toBeHidden({ timeout: 10_000 });

  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
  await expect(buyerPage.getByText("E2E Buyer Portal Chicken")).toBeVisible({ timeout: 10_000 });
  await buyerPage.getByRole("button", { name: /proceed to checkout/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 10_000,
  });

  // RECONCILIATION: on checkout (unlike the seller's New order page), the
  // zone Select *is* labeled via htmlFor ("Delivery Zone"), so its
  // accessible name is the label text, not the "Select a zone" placeholder.
  await buyerPage.getByRole("combobox", { name: /delivery zone/i }).click();
  await buyerPage.getByRole("option", { name: "Zone 1" }).click();
  await buyerPage.getByLabel(/delivery address/i).fill("77 Jalan Pembeli, Kuala Lumpur");
  // Here the delivery slot picker genuinely is a radiogroup of role="radio"
  // buttons, matching the brief's assumption (unlike the seller's Select).
  const firstOption = buyerPage.getByRole("radio").first();
  await expect(firstOption).toBeVisible({ timeout: 10_000 });
  await firstOption.click();
  await buyerPage.getByRole("button", { name: /place order/i }).click();

  // RECONCILIATION: placeOrder doesn't redirect to /orders. It stays on
  // /checkout and swaps in an inline "Order Placed!" confirmation card with
  // its own "View My Orders" button, which must be clicked to navigate.
  await expect(buyerPage.getByText("Order Placed!")).toBeVisible({ timeout: 10_000 });
  await buyerPage.getByRole("button", { name: /view my orders/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/orders/, {
    timeout: 10_000,
  });
  // RECONCILIATION: the buyer orders list renders status as a plain
  // <span>, not the shadcn Badge component, so there is no
  // [data-slot="badge"] here.
  await expect(buyerPage.getByText("Pending").first()).toBeVisible({ timeout: 10_000 });
});

test("buyer cancels a pending order", async ({ page, context }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, "E2E Buyer Cancel Chicken");

  const buyerPage = await context.newPage();
  await signInBuyer(buyerPage, BUYER.email, BUYER.password);

  const productCard = buyerPage
    .locator('[data-slot="card"]')
    .filter({ hasText: "E2E Buyer Cancel Chicken" });
  await expect(productCard).toBeVisible({ timeout: 10_000 });
  await productCard.getByRole("button", { name: /add to cart/i }).click();

  const addToCartDialog = buyerPage.getByRole("dialog");
  await expect(addToCartDialog).toBeVisible({ timeout: 10_000 });
  await addToCartDialog.getByRole("button", { name: "Piece", exact: true }).click();
  await addToCartDialog.getByLabel(/quantity/i).fill("2");
  await addToCartDialog.getByLabel(/min size/i).fill("1.2");
  await addToCartDialog.getByLabel(/max size/i).fill("1.5");
  await addToCartDialog.getByLabel(/can.t get this size/i).click();
  await buyerPage.getByRole("option", { name: "Cancel my order" }).click();
  await addToCartDialog.getByRole("button", { name: "Add to cart" }).click();
  await expect(addToCartDialog).toBeHidden({ timeout: 10_000 });

  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
  await buyerPage.getByRole("button", { name: /proceed to checkout/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/checkout/, {
    timeout: 10_000,
  });

  await buyerPage.getByRole("combobox", { name: /delivery zone/i }).click();
  await buyerPage.getByRole("option", { name: "Zone 1" }).click();
  await buyerPage.getByLabel(/delivery address/i).fill("21 Jalan Batal, Kuala Lumpur");
  const firstOption = buyerPage.getByRole("radio").first();
  await expect(firstOption).toBeVisible({ timeout: 10_000 });
  await firstOption.click();
  await buyerPage.getByRole("button", { name: /place order/i }).click();
  await expect(buyerPage.getByText("Order Placed!")).toBeVisible({ timeout: 10_000 });
  await buyerPage.getByRole("button", { name: /view my orders/i }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/orders/, {
    timeout: 10_000,
  });

  // getMyOrders sorts newest first, so the order just placed is the first
  // card — there may be an older order from the previous test for the same
  // seeded buyer account still sitting in the list.
  await buyerPage.getByRole("link", { name: /view details/i }).first().click();
  await expect(buyerPage.getByRole("heading", { name: /order details/i })).toBeVisible({
    timeout: 10_000,
  });
  // RECONCILIATION: "Cancel order" only opens a confirmation dialog; the
  // actual cancellation needs a second click on the destructive "Cancel
  // order" button inside that dialog.
  await buyerPage.getByRole("button", { name: /cancel order/i }).click();
  const cancelDialog = buyerPage.getByRole("dialog");
  await expect(cancelDialog).toBeVisible({ timeout: 10_000 });
  await cancelDialog.getByRole("button", { name: /cancel order/i }).click();

  // RECONCILIATION: the order detail page also renders status as a plain
  // <span>, not the shadcn Badge component.
  await expect(buyerPage.getByText("Cancelled").first()).toBeVisible({ timeout: 10_000 });
});
