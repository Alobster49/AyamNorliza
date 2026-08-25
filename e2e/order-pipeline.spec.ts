import { expect, test, type Page, type Locator } from "@playwright/test";
import {
  OWNER,
  createSellableProduct,
  seedZoneWithCoverage,
  shiftOrderToToday,
  signIn,
  uniqueFixtureName,
} from "./_fixtures";

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
  // Seed a zone whose only slot falls on tomorrow's weekday. The seeded
  // "Zone 1" runs Mon-Sat, so on a day whose tomorrow is a Sunday the
  // earliest bookable date is two days out - past getTodayTasks' horizon
  // (current_date + 1), which would leave the warehouse step with an empty
  // queue for reasons that have nothing to do with the pipeline.
  const zoneName = uniqueFixtureName("E2E Pipeline Zone");
  const truckName = uniqueFixtureName("E2E Pipeline Truck");
  await seedZoneWithCoverage(page, zoneName, truckName, uniqueFixtureName("TRK").slice(0, 20));

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
  await page.getByRole("option", { name: zoneName }).click();
  await fieldAfterLabel(page, "Delivery address").fill("12 Jalan Uji, Kuala Lumpur");
  const deliveryDate = await pickFirstDeliveryOption(page);

  await page.getByRole("button", { name: /create order/i }).click();
  // RECONCILIATION: createManualOrder redirects straight to the order detail
  // page (/orders/[orderId]), not back to the orders list, so there is no
  // row/"View" button to click here — the detail page is already loaded.
  await expect(page).toHaveURL(/\/ayam-norliza-pilot\/orders\/[0-9a-f-]{36}/, { timeout: 10_000 });
  const orderId = page.url().split("/").pop()!;

  // --- Confirm, applying the pre-declared fallback on the one line ---
  // RECONCILIATION: the pending panel doesn't ask a Yes/No question per
  // line; it toggles "Available" / "Not available", defaulting to
  // available. Marking a line "Not available" surfaces a
  // "Resulting fallback: <label>" badge.
  await expect(page.getByRole("button", { name: "Confirm order" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Not available" }).click();
  await expect(page.getByText("Resulting fallback: Mix sizes")).toBeVisible();
  // The surviving (mix-fallback) line needs its deal price keyed at confirm.
  await fieldAfterLabel(page, "Price / kg (RM)").fill("12.50");
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: "Confirmed" }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // --- Warehouse completes the allocate/weigh task ---
  // NOTE: getTodayTasks includes orders due tomorrow (not only strictly
  // today), so a freshly placed order's task shows up here right away.
  await page.goto("/ayam-norliza-pilot/tasks");
  // RECONCILIATION: the per-task cards with "Weight (kg)"/"Pieces"/"Done" are
  // gone. Tasks is now a kiosk (WeighStation on md+, SwipeDeck on mobile):
  // one line at a time, the current customer's name as the <h1>, digits typed
  // into a scale-style readout, Enter to confirm the line. The order submits
  // itself once its last line is confirmed - there is no save button.
  // The kiosk opens on whichever order is first in the queue, and the shared
  // database usually holds other pending tasks, so jump to this one via the
  // queue rail.
  await page.getByRole("button", { name: customerName }).first().click();
  const station = page.getByRole("heading", { name: customerName, exact: true });
  await expect(station).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type("5.2");
  await page.keyboard.press("Enter");
  // Pieces are optional (isPiecesValid treats "" as valid), so one weight is
  // enough for this single-line order to auto-complete and leave the queue.
  await expect(station).toBeHidden({ timeout: 10_000 });

  // --- Truck is loaded, departs, then comes back ---
  // The Loading board is today-only by design, but an order can only be
  // booked from tomorrow onwards, so a run created in this test can never be
  // loaded on the day it is created. Move the order and its run to today so
  // the load -> depart -> close chain is reachable in a single suite run.
  const runDate = await shiftOrderToToday(orderId);

  await page.goto("/ayam-norliza-pilot/loading");
  await page.getByRole("button", { name: `Mark ${customerName} loaded` }).click();

  await page.goto("/ayam-norliza-pilot/runs");
  await expect(page.getByRole("heading", { name: /runs/i })).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: the date filter is a bare <input type="date"> with no
  // associated <label> at all.
  await page.locator('input[type="date"]').fill(runDate);
  // Runs are now one tab per truck: pick this test's truck, then work inside
  // its panel. Other runs for the same date belong to earlier test runs.
  await page
    .getByRole("tablist", { name: /trucks running today/i })
    .getByRole("button", { name: new RegExp(truckName) })
    .click();
  // The name shows up in several places on a run card (stop row, stop
  // counter, and the reorder controls), so take the first match rather than
  // requiring a single one.
  await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 10_000 });

  // RECONCILIATION: departure and closing now go through an in-page confirm
  // step ("Send out" / "Close run"), not window.confirm, and the status chip
  // reads "In the yard" / "On the road" / "Back in". Assert on the chip so
  // the wait is tied to the real state rather than to the button that is
  // still mounted mid-request.
  await page.getByRole("button", { name: "Mark departed" }).click();
  await page.getByRole("button", { name: "Send out" }).click();
  await expect(page.getByText("On the road").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Close run" }).first().click();
  await page.getByRole("button", { name: "Close run" }).last().click();
  await expect(page.getByText("Back in").first()).toBeVisible({ timeout: 10_000 });

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
  await fieldAfterLabel(page, "Price / kg (RM)").fill("12.50");
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

  // This order is cancelled at confirm, so it never reaches the warehouse
  // queue - the stock "Zone 1" is enough here.
  await fieldAfterLabel(page, "Zone").click();
  await page.getByRole("option", { name: "Zone 1", exact: true }).click();
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
