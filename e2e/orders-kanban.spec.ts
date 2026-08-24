import { test, expect } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

/**
 * Kanban board on the seller orders page. Rendering and view-switcher
 * coverage only — drop-rule behavior is covered by the unit matrix in
 * src/features/orders/tests/unit/board-rules.test.ts, and the workflow
 * dialogs are exercised through the order detail flows in
 * order-pipeline.spec.ts.
 */

const COLUMNS = ["Pending", "Confirmed", "Ready", "Delivered", "Closed", "Cancelled"];

test("orders page defaults to a kanban board with all six status columns", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/orders");

  // Scoped to the page toolbar: the Pending column's own "New order" footer
  // button uses the same visible text, so a bare role+name lookup would be
  // ambiguous once both are on screen.
  await expect(
    page.getByTestId("orders-toolbar").getByRole("button", { name: "New order", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  for (const label of COLUMNS) {
    // Each column is a <section aria-label={status label}>.
    await expect(page.getByRole("region", { name: label })).toBeVisible();
  }
});

test("view switcher shows the table and the choice survives a reload", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/orders");

  await page.getByRole("button", { name: "Table" }).click();
  await expect(page.getByRole("tab", { name: /pending/i })).toBeVisible({ timeout: 10_000 });
  // Board columns are gone in table view.
  await expect(page.getByRole("region", { name: "Pending" })).toBeHidden();

  await page.reload();
  // Preference persisted in localStorage — table view sticks after reload.
  await expect(page.getByRole("tab", { name: /pending/i })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("region", { name: "Pending" })).toBeVisible({ timeout: 10_000 });
});
