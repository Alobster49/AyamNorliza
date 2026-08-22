import { expect, test, type Page } from "@playwright/test";
import { OWNER, signIn, uniqueFixtureName } from "./_fixtures";

// TEMPORARY LOCAL COPIES pending the fixtures-consolidation landing: these
// two helpers exist in the working-tree WIP version of ./_fixtures but are
// not yet committed there, so a clean checkout of this spec would otherwise
// fail typecheck. Delete these once _fixtures.ts exports them for real.

/**
 * Seed a category + product + one available "Standard" variant through the
 * seller Products screen, so order/checkout tests have something sellable.
 * `productName` also becomes the category name (suffixed) so each test's
 * fixtures are self-contained and never collide with another test's.
 *
 * Lives here rather than in each spec: three specs used to keep their own
 * copy, and every Products markup change broke the stale ones one at a time.
 */
async function createSellableProduct(page: Page, productName: string, price = "15.00") {
  await page.goto("/ayam-norliza-pilot/products");
  await page.getByRole("button", { name: "Add category" }).click();
  await page.getByLabel("Category Name").fill(`${productName} Category`);
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

  await page.getByRole("button", { name: "Add Product" }).click();
  await page.getByLabel("Product Name").fill(productName);
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: `${productName} Category` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

  // The card is a plain <article> (see product-card.tsx) and its trigger
  // reads "Add size"; the dialog it opens still titles itself
  // "Add Size/Option". One trigger per card, so scope to the card for the
  // product just created - a full suite run leaves many products behind.
  const card = page.getByRole("article").filter({ hasText: productName });
  await card.getByRole("button", { name: "Add size" }).click();
  await page.getByLabel(/name \(e\.g\., standard/i).fill("Standard");
  await page.getByLabel(/price/i).fill(price);
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Seed a zone with postcode coverage 50000-59999, a truck that serves it,
 * and a delivery slot on the weekday that falls tomorrow (so it always
 * lands inside get_delivery_options' `current_date + 1 .. + 14` lookahead
 * window regardless of which day the suite actually runs).
 */
async function seedZoneWithCoverage(
  page: Page,
  zoneName: string,
  truckName: string,
  truckCode: string,
) {
  await page.goto("/ayam-norliza-pilot/delivery");
  const rail = page.getByRole("navigation", { name: "Setup sections" });

  // Zone
  await rail.getByRole("button", { name: /^Zones/ }).click();
  await page.getByRole("button", { name: "Add zone" }).click();
  await page.getByLabel("Name", { exact: true }).fill(zoneName);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Zone created", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Truck
  await rail.getByRole("button", { name: /^Trucks/ }).click();
  await page.getByRole("button", { name: "Add truck" }).click();
  await page.getByLabel("Name", { exact: true }).fill(truckName);
  await page.getByLabel("Code", { exact: true }).fill(truckCode);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Truck created", { exact: true })).toBeVisible({ timeout: 20_000 });

  // "Zones served" is only rendered for an existing (just-saved) truck
  // record, and toggling a checkbox saves immediately ("Saved automatically.").
  // RECONCILIATION: the checkbox's `checked` is derived from snapshot state,
  // not toggled locally, so it stays unchecked until the toggleTruckZone
  // server action resolves and the parent re-renders — `.check()`'s
  // built-in re-click-if-unchanged retry fights that round trip and errors
  // out. Use a plain `.click()` and poll for the eventual `toBeChecked()`.
  const zoneCheckbox = page.getByRole("checkbox", { name: zoneName });
  await zoneCheckbox.click();
  await expect(zoneCheckbox).toBeChecked({ timeout: 20_000 });

  // Slot — weekday = tomorrow's day-of-week, so the option surfaces at the
  // earliest possible date the checkout page's lookahead window can show.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekdayLabel = WEEKDAY_LABELS[tomorrow.getDay()]!;

  await rail.getByRole("button", { name: /^Slots/ }).click();
  await page.getByRole("button", { name: "Add slot" }).click();
  await page.getByLabel("Truck").selectOption({ label: truckName });
  await page.getByLabel("Weekday").selectOption({ label: weekdayLabel });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Slot created", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Postcode range
  await rail.getByRole("button", { name: /^Zone postcodes/ }).click();
  // RECONCILIATION: these three fields are plain <label> elements wrapping
  // their control (no htmlFor/id), not shadcn <Label>s. getByLabel's
  // default substring match makes "To" hit "Toggle Sidebar" / "Toggle color
  // theme" chrome elsewhere on the page; getByLabel(..., { exact: true })
  // instead never resolves at all here (some accessible-name quirk with
  // this wrapping-label + native-<select>/<input> shape). Go straight at
  // the <label> element by its own text and descend into its control.
  const zoneField = page.locator("label").filter({ hasText: "Zone" });
  await zoneField.locator("select").selectOption({ label: zoneName });
  const fromField = page.locator("label").filter({ hasText: "From" });
  await fromField.locator("input").fill("50000");
  const toField = page.locator("label").filter({ hasText: "To" });
  await toField.locator("input").fill("59999");
  await page.getByRole("button", { name: "Add range" }).click();
  // Scope to the ranges list: a persisted DB accumulates zones from earlier
  // runs, and the overlap warnings above the list also name this zone, so a
  // bare `li` filter matches those too.
  await expect(
    page
      .getByRole("list", { name: "Zone postcode ranges" })
      .getByRole("listitem")
      .filter({ hasText: zoneName }),
  ).toBeVisible({ timeout: 20_000 });
}

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
