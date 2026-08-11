import { test, expect } from "@playwright/test";
import { OWNER, signIn, completeReauth } from "./_fixtures";

test("owner changes a member role and sees an audit row", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/users");
  // Change the role on the last member row (the non-owner seeded member);
  // the owner's own row is first and demoting it would remove our access.
  const select = page.locator("table tbody tr td select").last();
  await expect(select).toBeVisible({ timeout: 10_000 });
  // Must differ from the member's seeded role (`caretaker`), otherwise the
  // action short-circuits with "Member already has that role".
  await select.selectOption("supervisor");

  // Role changes are a sensitive action: the server returns `reauth_required`
  // and the island mounts the step-up dialog, which must be completed for the
  // change (and its audit event) to actually happen.
  await completeReauth(page, OWNER.password);

  await page.goto("/ayam-norliza-pilot/settings/audit-log");
  await expect(
    page.getByText(/identity\.role_changed|identity\.scope_changed/i).first(),
  ).toBeVisible({ timeout: 10_000 });
});
