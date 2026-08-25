import { test, expect } from "@playwright/test";
import { OWNER, TARGET, signIn, completeReauth } from "./_fixtures";

test.describe("users page admin actions", () => {
  test("members table shows names and emails, not UUIDs", async ({ page }) => {
    await signIn(page, OWNER.email, OWNER.password);
    await page.goto("/ayam-norliza-pilot/settings/users");
    const membersTable = page.locator("table.data-table").first();
    const firstUserCell = membersTable.locator("tbody tr td").first();
    await expect(firstUserCell).not.toContainText(/^[0-9a-f]{8}-/);
    await expect(firstUserCell).toContainText("@"); // email rendered
  });

  test("edit dialog renames a member", async ({ page }) => {
    await signIn(page, OWNER.email, OWNER.password);
    await page.goto("/ayam-norliza-pilot/settings/users");
    // Target the seeded non-owner member by email: the table cell no longer
    // renders the raw UUID (it's now name + email; the id only lives in a
    // `title` attribute), and this spec doesn't touch role/status so it
    // won't collide with role-change.spec.ts / deactivation.spec.ts.
    const newName = `Renamed Via E2E ${Date.now()}`;
    const targetRow = page.locator("table.data-table tbody tr", { hasText: TARGET.email });
    await targetRow.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Display name").fill(newName);
    await dialog.getByRole("button", { name: "Save" }).click();

    // Editing a member's details is a sensitive action: the server returns
    // `reauth_required` and the edit dialog closes itself while the page's
    // step-up dialog mounts and retries the save on success.
    await completeReauth(page, OWNER.password);

    await expect(page.locator("table.data-table").first()).toContainText(newName);
  });

  test("create user dialog adds a member", async ({ page }) => {
    await signIn(page, OWNER.email, OWNER.password);
    await page.goto("/ayam-norliza-pilot/settings/users");

    const displayName = `E2E Created ${Date.now()}`;
    const email = `e2e-created-${Date.now()}@example.com`;

    await page.getByRole("button", { name: "Create user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Display name").fill(displayName);
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();

    // Creating a user is also a sensitive action gated behind step-up reauth.
    await completeReauth(page, OWNER.password);

    await expect(page.locator("table.data-table").first()).toContainText(displayName);
  });
});
