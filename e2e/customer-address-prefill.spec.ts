import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { OWNER, signIn, uniqueFixtureName } from "./_fixtures";

// TEMPORARY LOCAL COPY, same reasoning as e2e/buyer-address.spec.ts: helpers
// in that spec are file-local by design (a previous branch broke when a spec
// imported a helper that existed only in an uncommitted _fixtures edit), so
// this is its own copy rather than an import. Adapted to a Johor Bahru
// (80000-81999) range instead of that spec's 50000-59999, since this file's
// customer fixtures use postcode 80100.
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

  // "Zones served" only renders for an existing (just-saved) truck record,
  // and toggling a checkbox saves immediately.
  const zoneCheckbox = page.getByRole("checkbox", { name: zoneName });
  await zoneCheckbox.click();
  await expect(zoneCheckbox).toBeChecked({ timeout: 20_000 });

  // Slot - weekday = tomorrow's day-of-week, so the option surfaces at the
  // earliest possible date the order screen's lookahead window can show.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekdayLabel = WEEKDAY_LABELS[tomorrow.getDay()]!;

  await rail.getByRole("button", { name: /^Slots/ }).click();
  await page.getByRole("button", { name: "Add slot" }).click();
  await page.getByLabel("Truck").selectOption({ label: truckName });
  await page.getByLabel("Weekday").selectOption({ label: weekdayLabel });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Slot created", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Postcode range 80000-81999 (Johor Bahru) covers postcode 80100, which
  // this file's customer fixtures use.
  await rail.getByRole("button", { name: /^Zone postcodes/ }).click();
  const zoneField = page.locator("label").filter({ hasText: "Zone" });
  await zoneField.locator("select").selectOption({ label: zoneName });
  const fromField = page.locator("label").filter({ hasText: "From" });
  await fromField.locator("input").fill("80000");
  const toField = page.locator("label").filter({ hasText: "To" });
  await toField.locator("input").fill("81999");

  // resolve_zone_for_postcode picks the alphabetically-first zone covering a
  // postcode, and this shared dev database accumulates one "E2E Prefill Zone
  // ..." row per prior run of this spec that ever added a matching range.
  // Clear this spec's own stale ranges first so the zone this run just
  // created is the only one covering 80000-81999 and the auto-resolution
  // assertion below is deterministic across reruns. The prefix is unique to
  // this spec (not shared with e2e/buyer-address.spec.ts's "E2E Addr Zone"),
  // so this cleanup only ever touches fixtures this spec created.
  const rangeList = page.getByRole("list", { name: "Zone postcode ranges" });
  const staleRanges = rangeList.getByRole("listitem").filter({ hasText: /^E2E Prefill Zone/ });
  for (let left = await staleRanges.count(); left > 0; left = await staleRanges.count()) {
    await staleRanges.first().getByRole("button", { name: "Delete" }).click();
    await expect(staleRanges).toHaveCount(left - 1, { timeout: 10_000 });
  }

  await page.getByRole("button", { name: "Add range" }).click();
  await expect(
    page
      .getByRole("list", { name: "Zone postcode ranges" })
      .getByRole("listitem")
      .filter({ hasText: zoneName }),
  ).toBeVisible({ timeout: 20_000 });
}

// RECONCILIATION (copied from e2e/order-pipeline.spec.ts, same file-local
// reasoning as seedZoneWithCoverage above): several fields on the New order
// screen render their <Label> as a plain sibling of the <input>/<textarea>
// with no htmlFor/id, so getByLabel() can't associate them. Grab the form
// control immediately following an exact-text label instead.
function fieldAfterLabel(root: Page | Locator, labelText: string) {
  return root.getByText(labelText, { exact: true }).locator("xpath=following-sibling::*[1]");
}

// A unique-per-call 10-digit Malaysian-mobile-shaped phone number, so two
// customers created in the same test (or across reruns) never collide.
let phoneSeq = 0;
function uniquePhone(): string {
  phoneSeq += 1;
  return "01" + String(Date.now() + phoneSeq).slice(-8);
}

/**
 * Insert a customer row exactly the way the SQL backfill migration
 * (20260823000008_customer_structured_address.sql) leaves one: `postcode`
 * set, `state`/`area` still null. That migration runs in plain SQL, which
 * cannot call the vendored JS postcode dataset, so this shape can only be
 * produced directly in the database - never through the app UI. Goes
 * straight at the local Supabase Postgres container the same way earlier
 * tasks on this branch verified schema directly (see
 * .superpowers/sdd/task-2-report.md), since there is no psql binary on the
 * host and RLS would otherwise stand in the way of a bare INSERT.
 */
function insertBackfilledCustomer(name: string, phone: string, address: string, postcode: string) {
  const escapedName = name.replace(/'/g, "''");
  const escapedAddress = address.replace(/'/g, "''");
  const sql = `insert into public.customers (organization_id, name, phone, address, postcode, created_by)
    select o.id, '${escapedName}', '${phone}', '${escapedAddress}', '${postcode}', u.id
    from public.organizations o, auth.users u
    where o.slug = 'ayam-norliza-pilot' and u.email = 'owner@ayam-norliza-pilot.example';`;
  execFileSync("docker", [
    "exec",
    "supabase_db_ayam-norliza-ops",
    "psql",
    "-U",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

test("structured address on a customer drives the order screen's delivery fields, and clears for a customer with none on file", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const zoneName = uniqueFixtureName("E2E Prefill Zone");
  const truckName = uniqueFixtureName("E2E Addr Truck");
  const truckCode = uniqueFixtureName("TRK").slice(0, 20);
  const customerName = uniqueFixtureName("E2E Addr Customer");
  const customerPhone = uniquePhone();
  const bareCustomerName = uniqueFixtureName("E2E Addr No-Address Customer");
  const bareCustomerPhone = uniquePhone();

  await signIn(page, OWNER.email, OWNER.password);
  await seedZoneWithCoverage(page, zoneName, truckName, truckCode);

  const dialog = page.getByRole("dialog");

  // Customer 1: full structured address. Postcode 80100 resolves to
  // Johor / Johor Bahru in the vendored dataset - assert State and Area
  // auto-fill from typing the postcode, before Create is even clicked.
  await page.goto("/ayam-norliza-pilot/customers");
  await page.getByRole("button", { name: "Add Customer" }).click();
  await dialog.getByLabel("Name *").fill(customerName);
  await dialog.getByLabel("Phone *").fill(customerPhone);
  await dialog.getByLabel("Address").fill("7 Jalan Prefill");
  await dialog.getByLabel("Postcode").fill("80100");
  await expect(dialog.getByRole("combobox", { name: "State" })).toContainText("Johor", {
    timeout: 20_000,
  });
  await expect(dialog.getByRole("combobox", { name: "Area" })).toContainText("Johor Bahru", {
    timeout: 20_000,
  });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("row").filter({ hasText: customerName })).toBeVisible({
    timeout: 20_000,
  });

  // Customer 2: no address on file at all. Exists purely to prove that
  // selecting a customer with nothing saved clears whatever a previously
  // selected customer left in the delivery fields - a real regression fixed
  // during review, where a stale address used to linger.
  await page.getByRole("button", { name: "Add Customer" }).click();
  await dialog.getByLabel("Name *").fill(bareCustomerName);
  await dialog.getByLabel("Phone *").fill(bareCustomerPhone);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("row").filter({ hasText: bareCustomerName })).toBeVisible({
    timeout: 20_000,
  });

  // Order screen: selecting customer 1 authoritatively fills the delivery
  // address/postcode from their saved record, then resolves and selects the
  // zone that covers that postcode - the auto-resolution.
  await page.goto("/ayam-norliza-pilot/orders/new");
  await expect(page.getByRole("heading", { name: /new order/i })).toBeVisible({ timeout: 10_000 });

  // Before any customer is selected, the Zone field shows its empty-state
  // placeholder - not the seeded zone name. This is the baseline the
  // post-selection assertion below needs to actually prove causality: without
  // it, that assertion couldn't distinguish "selecting the customer resolved
  // the zone" from "the zone field already showed that value on load".
  await expect(fieldAfterLabel(page, "Zone")).toContainText("Select zone", { timeout: 10_000 });

  await page.getByPlaceholder("Search by name or phone...").fill(customerName);
  const customerResult = page.getByRole("button", { name: customerName });
  await expect(customerResult).toBeVisible({ timeout: 20_000 });
  await customerResult.click();

  await expect(fieldAfterLabel(page, "Delivery address")).toHaveValue("7 Jalan Prefill", {
    timeout: 20_000,
  });
  await expect(fieldAfterLabel(page, "Postcode (optional)")).toHaveValue("80100", {
    timeout: 20_000,
  });
  await expect(fieldAfterLabel(page, "Zone")).toContainText(zoneName, { timeout: 20_000 });

  // Selecting customer 2 next must clear those same fields instead of
  // leaving customer 1's address behind, and surface the "no postcode on
  // file" toast instead of touching the zone.
  await page.getByPlaceholder("Search by name or phone...").fill(bareCustomerName);
  const bareCustomerResult = page.getByRole("button", { name: bareCustomerName });
  await expect(bareCustomerResult).toBeVisible({ timeout: 20_000 });
  await bareCustomerResult.click();

  await expect(fieldAfterLabel(page, "Delivery address")).toHaveValue("", { timeout: 20_000 });
  await expect(fieldAfterLabel(page, "Postcode (optional)")).toHaveValue("", { timeout: 20_000 });
  await expect(
    page.getByText("No postcode on file for this customer", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  // The zone customer 1 resolved is left alone - applyCustomer's documented
  // behaviour when the newly selected customer has no postcode on file.
  await expect(fieldAfterLabel(page, "Zone")).toContainText(zoneName, { timeout: 20_000 });
});

test("a customer backfilled by the SQL migration (postcode set, state/area null) completes state and area on edit", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const customerName = uniqueFixtureName("E2E Backfill Customer");
  const phone = uniquePhone();
  insertBackfilledCustomer(customerName, phone, "12 Jalan Backfill", "80100");

  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/customers");

  const row = page.getByRole("row").filter({ hasText: customerName });
  await expect(row).toBeVisible({ timeout: 20_000 });
  // RECONCILIATION: the row's Edit/Delete controls are icon-only buttons
  // with no accessible name (see customers-client.tsx - Pencil then Trash2,
  // in that fixed DOM order, nothing else in the row renders a <button>).
  await row.getByRole("button").first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Edit Customer", { exact: true })).toBeVisible({ timeout: 10_000 });
  // openEditDialog resolves state/area from the postcode client-side (the
  // dataset lookup, not a network round trip) whenever a customer has a
  // postcode but no state - exactly the shape the SQL backfill produces,
  // since SQL cannot read the vendored JS dataset.
  await expect(dialog.getByRole("combobox", { name: "State" })).toContainText("Johor", {
    timeout: 10_000,
  });
  await expect(dialog.getByRole("combobox", { name: "Area" })).toContainText("Johor Bahru", {
    timeout: 10_000,
  });
});
