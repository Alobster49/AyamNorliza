import { expect, test, type Page, type Locator } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

// Creates a category + product + one available "Standard" variant via the
// existing (unchanged by this plan) seller Products screen, so the order
// pipeline has something sellable to order. `productName` also becomes the
// category name (suffixed) so each test's fixtures are self-contained and
// never collide with another test's.
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
  await page.getByLabel(/price/i).fill("12.00");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
}

// RECONCILIATION: several fields on the New order / order detail screens
// render their <Label> as a plain sibling of the <input>/<textarea> with no
// `htmlFor`/`id`, so Playwright's getByLabel() can't associate them (unlike
// the Products dialogs above, which do wire htmlFor and work with getByLabel
// unchanged). This grabs the form control immediately following an
// exact-text label instead. Scope to a narrower `root` when the label text
// could repeat elsewhere on the page (e.g. a card per task).
function fieldAfterLabel(root: Page | Locator, labelText: string) {
  return root.getByText(labelText, { exact: true }).locator("xpath=following-sibling::*[1]");
}

// RECONCILIATION: the "Mode" and "If size unavailable" controls on the New
// order line are shadcn Selects (not radio buttons as originally assumed),
// each defaulting to a value ("Piece" / "Mix sizes"). Opens the Select whose
// trigger currently displays `currentValue` and picks `optionName`.
async function chooseSelect(page: Page, currentValue: string, optionName: string) {
  await page.getByRole("combobox", { name: currentValue, exact: true }).click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

// RECONCILIATION: unlike the buyer checkout page, the New order screen's
// "Delivery date & slot" field is a shadcn Select, not a radiogroup — so
// there is no `role="radio"` to read a date off of. Its options already
// spell out the ISO date, e.g. "2026-08-15 · Truck A 08:00–12:00 (5 left)".
async function pickFirstDeliveryOption(page: Page): Promise<string> {
  const trigger = page.getByRole("combobox", { name: /select a date and slot/i });
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible({ timeout: 10_000 });
  const text = (await firstOption.textContent()) ?? "";
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) {
    throw new Error(`Could not read an ISO delivery date out of option text: "${text}"`);
  }
  await firstOption.click();
  return match[0];
}

test("owner creates a manual order, confirms with a fallback, and takes it through to close", async ({
  page,
}) => {
  // RECONCILIATION: "Mark departed" / "Mark completed" on /runs go through a
  // native window.confirm() before calling setRunStatus. Playwright
  // auto-dismisses unhandled dialogs, which would silently no-op the click.
  page.on("dialog", (dialog) => dialog.accept());

  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, "E2E Pipeline Chicken");

  // --- Create the manual order ---
  await page.goto("/ayam-norliza-pilot/orders/new");
  await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /new customer/i }).click();
  await fieldAfterLabel(page, "Name *").fill("E2E Pipeline Customer");
  await fieldAfterLabel(page, "Phone *").fill("0123456789");
  await page.getByRole("button", { name: /save customer/i }).click();
  await expect(page.getByText("E2E Pipeline Customer")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("combobox", { name: /select product/i }).click();
  await page.getByRole("option", { name: "E2E Pipeline Chicken" }).click();
  await chooseSelect(page, "Piece", "Kg");
  await fieldAfterLabel(page, "Quantity").fill("5");
  await fieldAfterLabel(page, "Size min (kg)").fill("1.5");
  await fieldAfterLabel(page, "Size max (kg)").fill("1.8");
  // "Mix sizes" is already the line's default fallback; re-select it
  // explicitly so the test documents intent and stays correct if the
  // default ever changes.
  await chooseSelect(page, "Mix sizes", "Mix sizes");

  await page.getByRole("combobox", { name: /select zone/i }).click();
  await page.getByRole("option", { name: "Zone 1" }).click();
  await fieldAfterLabel(page, "Delivery address").fill("12 Jalan Uji, Kuala Lumpur");
  const deliveryDate = await pickFirstDeliveryOption(page);

  await page.getByRole("button", { name: /create order/i }).click();
  // RECONCILIATION: createManualOrder redirects straight to the order detail
  // page (/orders/[orderId]), not back to the orders list, so there is no
  // row/"View" button to click here — the detail page is already loaded.
  await expect(page).toHaveURL(/\/ayam-norliza-pilot\/orders\/[0-9a-f-]{36}/, { timeout: 10_000 });

  // --- Confirm, applying the pre-declared fallback on the one line ---
  // RECONCILIATION: the pending panel doesn't ask a Yes/No question per
  // line; it toggles "Available" / "Not available", defaulting to
  // available. Marking a line "Not available" surfaces a
  // "Resulting fallback: <label>" badge.
  await expect(page.getByRole("button", { name: "Confirm order" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Not available" }).click();
  await expect(page.getByText("Resulting fallback: Mix sizes")).toBeVisible();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: "Confirmed" }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // --- Warehouse completes the allocate/weigh task ---
  // NOTE: getTodayTasks includes orders due tomorrow (not only strictly
  // today), so a freshly placed order's task shows up here right away.
  await page.goto("/ayam-norliza-pilot/tasks");
  await expect(page.getByRole("heading", { name: /tasks/i })).toBeVisible({ timeout: 10_000 });
  const taskCard = page
    .getByText("E2E Pipeline Customer", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await expect(taskCard).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the task's weight/pieces fields are labeled "Weight
  // (kg)" / "Pieces", not "Warehouse weight" / "Warehouse pieces".
  await fieldAfterLabel(taskCard, "Weight (kg)").fill("5.2");
  await fieldAfterLabel(taskCard, "Pieces").fill("3");
  await taskCard.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("E2E Pipeline Customer")).toBeHidden({ timeout: 10_000 });

  // --- Run departs, then returns ---
  await page.goto("/ayam-norliza-pilot/runs");
  await expect(page.getByRole("heading", { name: /runs/i })).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the date filter is a bare <input type="date"> with no
  // associated <label> at all.
  await page.locator('input[type="date"]').fill(deliveryDate);
  await expect(page.getByText("E2E Pipeline Customer")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /mark departed/i }).click();
  await expect(page.getByText(/departed/i).first()).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the return-trip action is labeled "Mark completed", not
  // "Truck returned".
  await page.getByRole("button", { name: /mark completed/i }).click();
  await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10_000 });

  // --- Close with final weights and today's price ---
  await page.goto("/ayam-norliza-pilot/orders");
  await page.getByRole("tab", { name: /delivered/i }).click();
  const deliveredRow = page.getByRole("row", { name: /e2e pipeline customer/i });
  await expect(deliveredRow).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: order rows have no "View" button — the whole <tr> is
  // clickable and navigates to the detail page.
  await deliveredRow.click();

  await expect(page.getByRole("button", { name: "Close order" })).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: settlement labels are "Final weight (kg)" / "Final
  // pieces" / "Price / kg" (not "Final weight" / "Final pieces" / "Price per
  // kg"), and the submit button reads "Close order", not "Close".
  await fieldAfterLabel(page, "Final weight (kg)").fill("5.4");
  await fieldAfterLabel(page, "Final pieces").fill("3");
  await fieldAfterLabel(page, "Price / kg").fill("12.50");
  await page.getByRole("button", { name: "Close order" }).click();

  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: "Closed" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/67\.50/).first()).toBeVisible();
});

test("fallback = cancel cancels the order when the only line is unavailable at confirm", async ({
  page,
}) => {
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, "E2E Cancel Fallback Chicken");

  await page.goto("/ayam-norliza-pilot/orders/new");
  await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /new customer/i }).click();
  await fieldAfterLabel(page, "Name *").fill("E2E Cancel Customer");
  await fieldAfterLabel(page, "Phone *").fill("0123456780");
  await page.getByRole("button", { name: /save customer/i }).click();
  await expect(page.getByText("E2E Cancel Customer")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("combobox", { name: /select product/i }).click();
  await page.getByRole("option", { name: "E2E Cancel Fallback Chicken" }).click();
  // Mode stays "Piece" — that's the line's default.
  await fieldAfterLabel(page, "Quantity").fill("4");
  await fieldAfterLabel(page, "Size min (kg)").fill("1.4");
  await fieldAfterLabel(page, "Size max (kg)").fill("1.6");
  await chooseSelect(page, "Mix sizes", "Cancel my order");

  await page.getByRole("combobox", { name: /select zone/i }).click();
  await page.getByRole("option", { name: "Zone 1" }).click();
  await fieldAfterLabel(page, "Delivery address").fill("9 Jalan Uji, Kuala Lumpur");
  await pickFirstDeliveryOption(page);

  await page.getByRole("button", { name: /create order/i }).click();
  await expect(page).toHaveURL(/\/ayam-norliza-pilot\/orders\/[0-9a-f-]{36}/, { timeout: 10_000 });

  await expect(page.getByRole("button", { name: "Confirm order" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Not available" }).click();
  await page.getByRole("button", { name: "Confirm order" }).click();

  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: "Cancelled" }).first(),
  ).toBeVisible({ timeout: 10_000 });
});
