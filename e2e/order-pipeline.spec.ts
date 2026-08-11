import { expect, test, type Page, type Locator } from "@playwright/test";
import { OWNER, signIn, uniqueFixtureName } from "./_fixtures";

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

// RECONCILIATION (bigger than a label-text mismatch): every shadcn Select
// trigger on this page is unlabeled (no htmlFor/aria-label), and — unlike
// plain buttons, options, tabs, or rows — the ARIA "combobox" role does NOT
// support accessible-name-from-content. Chromium computes an EMPTY
// accessible name for these triggers regardless of their visible text (e.g.
// "Select product", "Piece", "Mix sizes"), so `getByRole("combobox", {name})`
// matches zero elements and any `.click()` against it hangs until the
// action timeout — confirmed by inspecting the live accessibility tree
// (`combobox[...]` has no computed name; `getByRole("combobox", {name:
// "Piece", exact:true})` returns 0 matches even though `el.textContent ===
// "Piece"`). This is standard ARIA/browser behavior, not an app bug. Locate
// these triggers the same way as the unlabeled inputs: by the element
// immediately following their (also-unlinked) <Label> text.
async function chooseSelect(trigger: Locator, optionName: string) {
  await trigger.click();
  await trigger.page().getByRole("option", { name: optionName, exact: true }).click();
}

// RECONCILIATION: unlike the buyer checkout page, the New order screen's
// "Delivery date & slot" field is a shadcn Select, not a radiogroup — so
// there is no `role="radio"` to read a date off of. Its options already
// spell out the ISO date, e.g. "2026-08-15 · Truck A 08:00–12:00 (5 left)".
// (Also affected by the unlabeled-combobox issue above — located the same
// way, via the label text it follows.)
async function pickFirstDeliveryOption(page: Page): Promise<string> {
  const trigger = fieldAfterLabel(page, "Delivery date & slot");
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
  // Full pipeline: catalog setup, manual order, confirm, weigh, run, settle.
  // Too long for the default 30s budget on the slower (tablet) project.
  test.setTimeout(120_000);
  // RECONCILIATION: "Mark departed" / "Mark completed" on /runs go through a
  // native window.confirm() before calling setRunStatus. Playwright
  // auto-dismisses unhandled dialogs, which would silently no-op the click.
  page.on("dialog", (dialog) => dialog.accept());

  const productName = uniqueFixtureName("E2E Pipeline Chicken");
  const customerName = uniqueFixtureName("E2E Pipeline Customer");
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, productName);

  // --- Create the manual order ---
  await page.goto("/ayam-norliza-pilot/orders/new");
  await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /new customer/i }).click();
  await fieldAfterLabel(page, "Name *").fill(customerName);
  await fieldAfterLabel(page, "Phone *").fill("0123456789");
  await page.getByRole("button", { name: /save customer/i }).click();
  await expect(page.getByText(customerName)).toBeVisible({ timeout: 10_000 });

  await fieldAfterLabel(page, "Product").click();
  await page.getByRole("option", { name: productName }).click();
  await chooseSelect(fieldAfterLabel(page, "Mode"), "Kg");
  await fieldAfterLabel(page, "Quantity").fill("5");
  await fieldAfterLabel(page, "Size min (kg)").fill("1.5");
  await fieldAfterLabel(page, "Size max (kg)").fill("1.8");
  // "Mix sizes" is already the line's default fallback; re-select it
  // explicitly so the test documents intent and stays correct if the
  // default ever changes.
  await chooseSelect(fieldAfterLabel(page, "If size unavailable"), "Mix sizes");

  await fieldAfterLabel(page, "Zone").click();
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
    .getByText(customerName, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await expect(taskCard).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the task's weight/pieces fields are labeled "Weight
  // (kg)" / "Pieces", not "Warehouse weight" / "Warehouse pieces".
  await fieldAfterLabel(taskCard, "Weight (kg)").fill("5.2");
  await fieldAfterLabel(taskCard, "Pieces").fill("3");
  await taskCard.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(customerName)).toBeHidden({ timeout: 10_000 });

  // --- Run departs, then returns ---
  await page.goto("/ayam-norliza-pilot/runs");
  await expect(page.getByRole("heading", { name: /runs/i })).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the date filter is a bare <input type="date"> with no
  // associated <label> at all.
  await page.locator('input[type="date"]').fill(deliveryDate);
  await expect(page.getByText(customerName)).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION (test bug, found via direct DB inspection): the "Mark
  // departed"/"Mark completed" BUTTONS themselves contain the words
  // "departed"/"completed" in their own labels and stay mounted right up
  // until the transition actually lands, so a loose `getByText(/departed/i)`
  // is satisfied by the *button* immediately on click — before setRunStatus
  // has actually round-tripped to the server. That let the very next
  // `page.goto` abort the in-flight request (observed as the run silently
  // stuck on "departed" in the DB after "Mark completed" was clicked, only
  // on the tablet/WebKit project, presumably because WebKit cancels
  // in-flight requests on navigation more eagerly than Chromium). Scope to
  // the status Badge specifically so the wait is tied to the real state.
  await page.getByRole("button", { name: /mark departed/i }).click();
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: "Departed" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the return-trip action is labeled "Mark completed", not
  // "Truck returned".
  await page.getByRole("button", { name: /mark completed/i }).click();
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: "Completed" }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // --- Close with final weights and today's price ---
  await page.goto("/ayam-norliza-pilot/orders");
  // The orders page now defaults to the kanban board; the close flow below
  // drives the table, so switch views first.
  await page.getByRole("button", { name: "Table" }).click();
  await page.getByRole("tab", { name: /delivered/i }).click();
  // Match this run's unique customer name — a generic /e2e pipeline customer/i
  // regex trips strict mode when a previous run's order is still in the list.
  const deliveredRow = page.getByRole("row", { name: customerName });
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
  const productName = uniqueFixtureName("E2E Cancel Fallback Chicken");
  const customerName = uniqueFixtureName("E2E Cancel Customer");
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, productName);

  await page.goto("/ayam-norliza-pilot/orders/new");
  await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /new customer/i }).click();
  await fieldAfterLabel(page, "Name *").fill(customerName);
  await fieldAfterLabel(page, "Phone *").fill("0123456780");
  await page.getByRole("button", { name: /save customer/i }).click();
  await expect(page.getByText(customerName)).toBeVisible({ timeout: 10_000 });

  await fieldAfterLabel(page, "Product").click();
  await page.getByRole("option", { name: productName }).click();
  // Mode stays "Piece" — that's the line's default.
  await fieldAfterLabel(page, "Quantity").fill("4");
  await fieldAfterLabel(page, "Size min (kg)").fill("1.4");
  await fieldAfterLabel(page, "Size max (kg)").fill("1.6");
  await chooseSelect(fieldAfterLabel(page, "If size unavailable"), "Cancel my order");

  await fieldAfterLabel(page, "Zone").click();
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
