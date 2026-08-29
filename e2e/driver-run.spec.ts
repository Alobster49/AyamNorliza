import { expect, test, type Page, type Locator } from "@playwright/test";
import {
  OWNER,
  createSellableProduct,
  markOrderLoaded,
  seedZoneWithCoverage,
  signIn,
  uniqueFixtureName,
} from "./_fixtures";

// RECONCILIATION: copied from order-pipeline.spec.ts rather than imported —
// several fields on the New order / order detail screens render their
// <Label> as a plain sibling of the <input>/<textarea> with no
// `htmlFor`/`id`, so Playwright's getByLabel() can't associate them. This
// grabs the form control immediately following an exact-text label instead.
function fieldAfterLabel(root: Page | Locator, labelText: string) {
  return root.getByText(labelText, { exact: true }).locator("xpath=following-sibling::*[1]");
}

// RECONCILIATION: copied from order-pipeline.spec.ts — every shadcn Select
// trigger on the New order screen is unlabeled, and the ARIA "combobox" role
// does not support accessible-name-from-content, so getByRole("combobox",
// {name}) matches nothing. Locate the trigger by the label text it follows
// instead, same as the plain inputs above.
async function chooseSelect(trigger: Locator, optionName: string) {
  await trigger.click();
  await trigger.page().getByRole("option", { name: optionName, exact: true }).click();
}

// RECONCILIATION: copied from order-pipeline.spec.ts — the "Delivery date &
// slot" field is a shadcn Select whose options spell out the ISO date, e.g.
// "2026-08-15 · Truck A 08:00-12:00 (5 left)".
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

/**
 * Create an active driver-role member directly via the service-role REST API.
 *
 * There is no signup/invite flow this suite can drive for a *driver*
 * specifically (the invite flow is covered elsewhere, and going through it
 * here would mean confirming an email nobody can read) — so this mirrors
 * `_fixtures.ts`'s existing pattern of reaching around the UI with the
 * service-role key (see `parkTruckInFirstBay`, `reactivateTarget`) rather
 * than inventing a new seeding mechanism. `dispatch_assign_driver` (called
 * from the Runs UI below) requires the member to already be an active
 * 'driver'-role row before a run can be handed to them.
 */
async function createDriverAccount(
  displayName: string,
): Promise<{ email: string; password: string; userId: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("createDriverAccount needs SUPABASE_SERVICE_ROLE_KEY (see playwright.config.ts)");
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const email = `driver.${Math.random().toString(36).slice(2, 10)}@ayam-norliza-pilot.example`;
  const password = "password123";

  const userResponse = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    }),
  });
  const created = (await userResponse.json()) as { id?: string; user?: { id?: string } };
  const userId = created.id ?? created.user?.id;
  if (!userId) {
    throw new Error(`createDriverAccount: could not create auth user: ${JSON.stringify(created)}`);
  }

  const orgResponse = await fetch(`${url}/rest/v1/organizations?slug=eq.ayam-norliza-pilot&select=id`, {
    headers,
  });
  const [org] = (await orgResponse.json()) as Array<{ id: string }>;
  if (!org) throw new Error("createDriverAccount: pilot organization not found");

  await fetch(`${url}/rest/v1/profiles`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, display_name: displayName, status: "active" }),
  });

  await fetch(`${url}/rest/v1/organization_members`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      organization_id: org.id,
      user_id: userId,
      role: "driver",
      status: "active",
    }),
  });

  return { email, password, userId };
}

type SeededRun = {
  orderId: string;
  productName: string;
  customerName: string;
  driver: { email: string; password: string; userId: string };
};

/**
 * Seed one kg-mode order all the way to 'ready' (confirmed at `priceKg`,
 * warehouse-weighed) on a run with a driver assigned to it, and hand back
 * everything the driver-side half of the test needs.
 *
 * Mirrors order-pipeline.spec.ts's create -> confirm -> warehouse-weigh
 * steps exactly (same fields, same button names), since that spec was
 * recently rekeyed to confirm-time pricing and this order needs the same
 * price_per_kg-at-confirm shape driver_deliver_stop expects.
 */
async function seedReadyOrderForDriver(
  page: Page,
  opts: { priceKg: string; warehouseWeightKg: string },
): Promise<SeededRun> {
  const productName = uniqueFixtureName("E2E Driver Chicken");
  const customerName = uniqueFixtureName("E2E Driver Customer");
  const zoneName = uniqueFixtureName("E2E Driver Zone");
  const truckName = uniqueFixtureName("E2E Driver Truck");
  const driverName = uniqueFixtureName("E2E Driver");

  await createSellableProduct(page, productName);
  await seedZoneWithCoverage(page, zoneName, truckName, uniqueFixtureName("TRK").slice(0, 20));
  const driver = await createDriverAccount(driverName);

  // --- Create the manual order (one kg-mode line) ---
  await page.goto("/ayam-norliza-pilot/orders/new");
  await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /new customer/i }).click();
  await fieldAfterLabel(page, "Name *").fill(customerName);
  await fieldAfterLabel(page, "Phone *").fill("0123456788");
  await page.getByRole("button", { name: /save customer/i }).click();
  await expect(page.getByText(customerName)).toBeVisible({ timeout: 10_000 });

  await fieldAfterLabel(page, "Product").click();
  await page.getByRole("option", { name: productName }).click();
  await chooseSelect(fieldAfterLabel(page, "Mode"), "Kg");
  await fieldAfterLabel(page, "Quantity").fill("2");
  await fieldAfterLabel(page, "Size min (kg)").fill("1");
  await fieldAfterLabel(page, "Size max (kg)").fill("1.5");

  await fieldAfterLabel(page, "Zone").click();
  await page.getByRole("option", { name: zoneName }).click();
  await fieldAfterLabel(page, "Delivery address").fill("1 Jalan Uji Pemandu, Kuala Lumpur");
  const deliveryDate = await pickFirstDeliveryOption(page);

  await page.getByRole("button", { name: /create order/i }).click();
  await expect(page).toHaveURL(/\/ayam-norliza-pilot\/orders\/[0-9a-f-]{36}/, { timeout: 10_000 });
  const orderId = page.url().split("/").pop()!;

  // --- Confirm, keying today's price/kg (item stays "Available") ---
  await expect(page.getByRole("button", { name: "Confirm order" })).toBeVisible({ timeout: 10_000 });
  await fieldAfterLabel(page, "Price / kg (RM)").fill(opts.priceKg);
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(
    page.locator('[data-slot="badge"]').filter({ hasText: "Confirmed" }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // --- Warehouse weighs the order, moving it to 'ready' ---
  await page.goto("/ayam-norliza-pilot/tasks");
  await page.getByRole("button", { name: customerName }).first().click();
  const station = page.getByRole("heading", { name: customerName, exact: true });
  await expect(station).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type(opts.warehouseWeightKg);
  await page.keyboard.press("Enter");
  await expect(station).toBeHidden({ timeout: 10_000 });

  // --- Office puts the driver on the run ---
  await page.goto("/ayam-norliza-pilot/runs");
  await expect(page.getByRole("heading", { name: /runs/i })).toBeVisible({ timeout: 10_000 });
  await page.locator('input[type="date"]').fill(deliveryDate);
  await page
    .getByRole("tablist", { name: /trucks running today/i })
    .getByRole("button", { name: new RegExp(truckName) })
    .click();
  await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 10_000 });
  // RECONCILIATION: `getByLabel("Driver", {exact:true})` resolves correctly
  // (the accessibility tree names this <select> "Driver" with no ambiguity)
  // but chaining `.selectOption()` off it hung indefinitely in this suite's
  // runner even once the right <option> was confirmed present in the DOM.
  // Scoping through the wrapping <label> by text, the same pattern already
  // used for the deliver-sheet item rows below, selects reliably instead.
  const driverSelect = page.locator("label").filter({ hasText: "Driver" }).locator("select");
  await driverSelect.selectOption({ label: driverName });
  // exact: the toast text is a substring of the aria-live announcer's own
  // "Notification Driver assigned" text, so a loose match is ambiguous.
  await expect(page.getByText("Driver assigned", { exact: true })).toBeVisible({ timeout: 10_000 });

  return { orderId, productName, customerName, driver };
}

test("driver starts run, keys weights, invoice shows recomputed total", async ({ page, browser }) => {
  // Long: catalog + zone + driver-account + order + confirm + weigh + run
  // assignment, then a second (driver) session through start/arrive/deliver
  // /invoice. Every route hit here is a first-visit dev-server compile too.
  test.setTimeout(240_000);
  await signIn(page, OWNER.email, OWNER.password);
  const { orderId, productName, customerName, driver } = await seedReadyOrderForDriver(page, {
    priceKg: "12",
    warehouseWeightKg: "2.3",
  });

  // The driver needs their own browser context: reusing `page`'s cookie jar
  // would replace the owner's session, not add a second one alongside it.
  const driverContext = await browser.newContext();
  const driverPage = await driverContext.newPage();
  await signIn(driverPage, driver.email, driver.password);
  await expect(driverPage).toHaveURL(/\/drive\/ayam-norliza-pilot(?:[/?#]|$)/, { timeout: 10_000 });

  // The order was weighed but never loaded: the deck holds the driver at the
  // yard, matching the runs board's departure gate.
  const startButton = driverPage.getByRole("button", { name: "Start delivering" });
  await expect(startButton).toBeVisible({ timeout: 15_000 });
  await expect(startButton).toBeDisabled();
  await expect(driverPage.getByText("The truck is still being loaded")).toBeVisible();

  // The loading bay signs the stop off; a reload beats waiting out the
  // deck's 15 s self-refresh.
  await markOrderLoaded(orderId);
  await driverPage.reload();
  await expect(startButton).toBeVisible({ timeout: 15_000 });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(driverPage.getByRole("button", { name: "I'm at the door" })).toBeVisible({
    timeout: 10_000,
  });
  await driverPage.getByRole("button", { name: "I'm at the door" }).click();

  await expect(driverPage.getByRole("button", { name: "Delivered" })).toBeVisible({ timeout: 10_000 });
  await driverPage.getByRole("button", { name: "Delivered" }).click();

  const sheet = driverPage.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  const itemRow = sheet.locator("label").filter({ hasText: productName });
  await itemRow.getByRole("textbox").fill("2.35");

  // Live total = 2.35 kg x RM12/kg = RM28.20, recomputed as the driver types.
  const liveTotalRow = sheet.getByText("Total to collect", { exact: true }).locator("..");
  await expect(liveTotalRow).toContainText(/28\.20/);

  const confirmButton = sheet.getByRole("button", { name: "Confirm delivery" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  // exact: the toast text is a substring of the aria-live announcer's own
  // "Notification Delivered to ..." text (same duplication as the "Driver
  // assigned" toast above), so a loose match is ambiguous.
  await expect(
    driverPage.getByText(`Delivered to ${customerName}`, { exact: true }),
  ).toBeVisible({ timeout: 10_000 });

  // A single-stop run's whole-route list only renders while there is still a
  // current stop (buildDriverDeck's `current` goes null once the only order
  // is delivered), so the deck falls straight to the "every stop is done"
  // screen with no list left to click "Invoice" from. Open the invoice the
  // deck itself links every delivered stop to, directly.
  await driverPage.goto(`/drive/ayam-norliza-pilot/invoice/${orderId}`);

  const lineRow = driverPage.locator("tbody tr").filter({ hasText: productName });
  await expect(lineRow).toContainText(/2\.35 kg/);
  await expect(lineRow).toContainText(/12\.00/);
  await expect(lineRow).toContainText(/28\.20/);

  const grandTotalRow = driverPage.locator("tfoot tr");
  await expect(grandTotalRow).toContainText(/28\.20/);

  await driverContext.close();
});

test("confirm is blocked until every item has a weight", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, OWNER.email, OWNER.password);
  const { orderId, productName, driver } = await seedReadyOrderForDriver(page, {
    priceKg: "12",
    warehouseWeightKg: "2.3",
  });
  await markOrderLoaded(orderId);

  const driverContext = await browser.newContext();
  const driverPage = await driverContext.newPage();
  await signIn(driverPage, driver.email, driver.password);

  await expect(driverPage.getByRole("button", { name: "Start delivering" })).toBeVisible({
    timeout: 15_000,
  });
  await driverPage.getByRole("button", { name: "Start delivering" }).click();
  await expect(driverPage.getByRole("button", { name: "I'm at the door" })).toBeVisible({
    timeout: 10_000,
  });
  await driverPage.getByRole("button", { name: "I'm at the door" }).click();
  await expect(driverPage.getByRole("button", { name: "Delivered" })).toBeVisible({ timeout: 10_000 });
  await driverPage.getByRole("button", { name: "Delivered" }).click();

  const sheet = driverPage.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  // Sanity: the item row this run cares about is actually in the sheet,
  // before asserting on the confirm button next to it.
  await expect(sheet.locator("label").filter({ hasText: productName })).toBeVisible();

  const confirmButton = sheet.getByRole("button", { name: "Confirm delivery" });
  await expect(confirmButton).toBeDisabled();

  await driverContext.close();
});
