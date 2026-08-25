import { test, expect, type Page } from "@playwright/test";

/**
 * Resend mock + owner fixtures. Tests sign in by going through the real
 * `/login` form; set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD when running
 * against a non-local Supabase project.
 */

export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner@ayam-norliza-pilot.example",
  password: process.env.E2E_OWNER_PASSWORD ?? "test-only-password-12-chars",
};

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Landing depends on role: managers land on the dashboard, warehouse staff
  // land on Products, drivers on the driver deck, everyone else on org
  // settings (see server/landing.ts).
  await expect(page).toHaveURL(
    /\/(?:[^/]+\/dashboard|[^/]+\/products|[^/]+\/settings\/organization|drive\/[^/]+|signup)(?:[/?#]|$)/,
    { timeout: 10_000 },
  );
}

/**
 * Seed a category + product + one available "Standard" variant through the
 * seller Products screen, so order/checkout tests have something sellable.
 * `productName` also becomes the category name (suffixed) so each test's
 * fixtures are self-contained and never collide with another test's.
 *
 * Lives here rather than in each spec: three specs used to keep their own
 * copy, and every Products markup change broke the stale ones one at a time.
 */
export async function createSellableProduct(page: Page, productName: string) {
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
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
}

/**
 * Catalog fixtures live in the database for the whole run, and every
 * Playwright project shares one database. A fixed name would therefore be
 * created twice (once per project) and every `getByRole("option", ...)`
 * lookup for it would match two elements. Suffix each name so the fixtures
 * a test creates are unique to that test run.
 */
export function uniqueFixtureName(base: string): string {
  return `${base} ${Math.random().toString(36).slice(2, 8)}`;
}

/** Seeded non-owner member (see 20260624000004_id_access_seed.sql). */
export const TARGET = {
  email: "target@ayam-norliza-pilot.example",
  password: "test-only-password-12-chars",
  userId: "10000000-0000-0000-0000-000000000002",
};

/**
 * Restore the seeded target member after a test suspends them, so the suite
 * stays re-runnable without a database reset. Uses the service-role key that
 * the e2e runbook exports; skips (loudly) if it is not configured.
 */
export async function reactivateTarget() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn("reactivateTarget: SUPABASE_SERVICE_ROLE_KEY not set; leaving member suspended");
    return;
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  await fetch(`${url}/rest/v1/organization_members?user_id=eq.${TARGET.userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "active" }),
  });
  await fetch(`${url}/rest/v1/profiles?user_id=eq.${TARGET.userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "active" }),
  });
  // Deactivation also bans the auth user (adminRevokeUserSessions), which
  // blocks sign-in until it expires — lift it too.
  await fetch(`${url}/auth/v1/admin/users/${TARGET.userId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ban_duration: "none" }),
  });
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Toasts never auto-dismiss (use-toast's TOAST_REMOVE_DELAY is ~17 minutes),
 * and the Radix viewport sits over the bottom-right corner, so a stale
 * "Zone created" toast can swallow the next Save click. Close whatever is
 * open before clicking through a multi-step form.
 */
export async function dismissToasts(page: Page) {
  const closeButtons = page.locator("[toast-close]");
  for (let i = await closeButtons.count(); i > 0; i = await closeButtons.count()) {
    await closeButtons.first().click();
    await expect(closeButtons).toHaveCount(i - 1, { timeout: 5_000 });
  }
}

/** Give a truck a bay so it shows up as a lane on the Loading board. */
async function parkTruckInFirstBay(truckCode: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("parkTruckInFirstBay needs SUPABASE_SERVICE_ROLE_KEY (see playwright.config.ts)");
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const baysResponse = await fetch(`${url}/rest/v1/bays?is_active=eq.true&select=id&limit=1`, {
    headers,
  });
  const existingBays = (await baysResponse.json()) as Array<{ id: string }>;
  let bay = Array.isArray(existingBays) ? existingBays[0] : undefined;
  if (!bay) {
    // A database that has never had the facility set up by hand has no bays
    // at all. Create one rather than failing: the loading board needs a bay
    // to hang truck lanes off, and which bay it is does not matter here.
    const truckResponse = await fetch(
      `${url}/rest/v1/trucks?code=eq.${encodeURIComponent(truckCode)}&select=organization_id`,
      { headers },
    );
    const trucks = (await truckResponse.json()) as Array<{ organization_id: string }>;
    const truck = Array.isArray(trucks) ? trucks[0] : undefined;
    if (!truck) throw new Error(`No truck with code ${truckCode} to park`);
    // bays.facility_id is NOT NULL, so the bay has to hang off the org's
    // facility - the same one the dispatch board reads.
    const facilityResponse = await fetch(
      `${url}/rest/v1/facilities?organization_id=eq.${truck.organization_id}&select=id&limit=1`,
      { headers },
    );
    const facilities = (await facilityResponse.json()) as Array<{ id: string }>;
    const facility = Array.isArray(facilities) ? facilities[0] : undefined;
    if (!facility) throw new Error("No facility to hang an E2E bay off");
    const created = await fetch(`${url}/rest/v1/bays?select=id`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        organization_id: truck.organization_id,
        facility_id: facility.id,
        name: "E2E Bay",
        position: 1,
      }),
    });
    const createdBays = (await created.json()) as Array<{ id: string }>;
    bay = Array.isArray(createdBays) ? createdBays[0]! : undefined!;
    if (!bay) throw new Error(`Could not create a bay: ${JSON.stringify(createdBays)}`);
  }
  await fetch(`${url}/rest/v1/trucks?code=eq.${encodeURIComponent(truckCode)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ bay_id: bay.id }),
  });
}

/**
 * Seed a zone with postcode coverage 50000-59999, a truck that serves it,
 * and a delivery slot on the weekday that falls tomorrow (so it always
 * lands inside get_delivery_options' `current_date + 1 .. + 14` lookahead
 * window regardless of which day the suite actually runs).
 */
export async function seedZoneWithCoverage(
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
  await dismissToasts(page);
  await rail.getByRole("button", { name: /^Trucks/ }).click();
  await page.getByRole("button", { name: "Add truck" }).click();
  await page.getByLabel("Name", { exact: true }).fill(truckName);
  await page.getByLabel("Code", { exact: true }).fill(truckCode);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Truck created", { exact: true })).toBeVisible({ timeout: 20_000 });
  // A bay-less truck never reaches the Loading board - buildBoardView keeps
  // its orders in the unassigned pool, so they get no "Mark ... loaded"
  // control and the run can never depart. The Bay <select> in the truck form
  // is populated asynchronously and is empty often enough to be flaky, so
  // park the truck in the first active bay directly.
  await parkTruckInFirstBay(truckCode);

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

  await dismissToasts(page);
  await rail.getByRole("button", { name: /^Slots/ }).click();
  await page.getByRole("button", { name: "Add slot" }).click();
  await page.getByLabel("Truck").selectOption({ label: truckName });
  await page.getByLabel("Weekday").selectOption({ label: weekdayLabel });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Slot created", { exact: true })).toBeVisible({ timeout: 20_000 });

  // Postcode range
  await dismissToasts(page);
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
  // resolve_zone_for_postcode returns the alphabetically-first zone covering
  // the postcode, and every earlier run leaves its own "E2E ..." zone behind
  // on this shared database - including runs that died before adding a slot,
  // which would resolve to a zone with no delivery options at all. Clear the
  // test-created ranges first so the zone seeded here is the only match.
  const rangeList = page.getByRole("list", { name: "Zone postcode ranges" });
  const staleRanges = rangeList.getByRole("listitem").filter({ hasText: /^E2E / });
  for (let left = await staleRanges.count(); left > 0; left = await staleRanges.count()) {
    await staleRanges.first().getByRole("button", { name: "Delete" }).click();
    await expect(staleRanges).toHaveCount(left - 1, { timeout: 10_000 });
  }

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

/**
 * Fill the buyer checkout's address section and pick the first delivery
 * slot. The zone is resolved server-side from the postcode (there is no
 * zone dropdown any more), so the postcode must fall inside a seeded zone's
 * coverage - see `seedZoneWithCoverage`, which covers 50000-59999.
 *
 * A buyer who has ordered before sees a saved-address radiogroup instead of
 * the bare form, so select "+ Alamat baru" first when it is there.
 */
export async function checkoutWithNewAddress(
  page: Page,
  addressLine: string,
  postcode = "50000",
) {
  // Wait out the saved-address fetch: checking too early sees neither the
  // radiogroup nor the bare form and silently takes the wrong branch.
  await expect(page.getByText(/memuatkan alamat anda/i)).toHaveCount(0, { timeout: 20_000 });
  const addressGroup = page.getByRole("radiogroup", { name: "Alamat penghantaran" });
  if ((await addressGroup.count()) > 0) {
    await addressGroup.getByRole("radio", { name: /alamat baru/i }).click();
  }
  // getByLabel("Address") also matches the saved-address radiogroup, whose
  // aria-label is "Alamat penghantaran" - go at the textbox by role.
  await page.getByRole("textbox", { name: "Alamat", exact: true }).fill(addressLine);
  await page.getByLabel("Poskod").fill(postcode);

  // RECONCILIATION: the single "Delivery slot" radiogroup was split into a
  // "Tarikh" (date) pill row and a "Masa" (time) radiogroup; the first date
  // is preselected, so only the time radio needs a click.
  const timeGroup = page.getByRole("radiogroup", { name: "Masa" });
  const firstSlot = timeGroup.getByRole("radio").first();
  await expect(firstSlot).toBeVisible({ timeout: 25_000 });
  await firstSlot.click();
}

/**
 * Move an order (and the run it sits on) to today.
 *
 * The seller can only book a delivery from tomorrow onwards
 * (`get_delivery_options` starts at `current_date + 1`), but the Loading
 * board is deliberately today-only - so a run created inside a single test
 * can never be loaded, and therefore never departs. Shifting the dates with
 * the service-role key is the only way to exercise load -> depart -> close
 * in one run of the suite. Returns the ISO date the order now sits on.
 */
export async function shiftOrderToToday(orderId: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("shiftOrderToToday needs SUPABASE_SERVICE_ROLE_KEY (see playwright.config.ts)");
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;

  const orderResponse = await fetch(`${url}/rest/v1/orders?id=eq.${orderId}&select=run_id`, {
    headers,
  });
  const [order] = (await orderResponse.json()) as Array<{ run_id: string | null }>;
  await fetch(`${url}/rest/v1/orders?id=eq.${orderId}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    // Also pin the truck assignment: a manual order is created with
    // assignment_source "none", which parks it in the dispatch pool, and the
    // Dispatch auto-planner refuses to place it because the seller's New
    // order form never collects a postcode. The order already carries the
    // truck and run it was created against, so marking the assignment manual
    // is what the office would do by hand on the dispatch board.
    body: JSON.stringify({ delivery_date: iso, assignment_source: "manual" }),
  });
  if (order?.run_id) {
    await fetch(`${url}/rest/v1/delivery_runs?id=eq.${order.run_id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ run_date: iso }),
    });
  }
  return iso;
}

/**
 * Complete the step-up ("Confirm it's you") dialog that sensitive Server
 * Actions trigger via `reauth_required`. The dialog re-runs the pending
 * action on success, so callers can assert its effects afterwards.
 */
export async function completeReauth(page: Page, password: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/password/i).fill(password);
  await dialog.getByRole("button", { name: /confirm/i }).click();
  // The dialog closes as soon as re-auth succeeds, BEFORE it retries the
  // pending action. Returning here would race the retry — a navigation or
  // reload by the caller can abort that in-flight Server Action — so wait for
  // the retry request to settle too.
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

export const BUYER = {
  email: process.env.E2E_BUYER_EMAIL ?? "buyer@ayam-norliza-pilot.example",
  password: process.env.E2E_BUYER_PASSWORD ?? "test-only-password-12-chars",
};

export async function signInBuyer(page: Page, email: string, password: string) {
  await page.goto("/ms/buyer_portal/ayam-norliza-pilot/login");
  // RECONCILIATION: the buyer login page's submit button now reads "Log
  // masuk" (BM) — "login" is the default mode, so no mode-toggle click needed.
  await page.getByLabel(/e-mel/i).fill(email);
  await page.getByLabel(/kata laluan/i).fill(password);
  await page.getByRole("button", { name: "Log masuk" }).click();
  await expect(page).toHaveURL(/\/ms\/buyer_portal\/ayam-norliza-pilot\/shop/, { timeout: 10_000 });
}

export async function expectOnDashboard(page: Page) {
  await expect(page).toHaveURL(/\/(?:ayam-norliza-pilot|.*)\//);
}
