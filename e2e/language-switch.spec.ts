import { expect, test } from "@playwright/test";

test.describe("language switching", () => {
  test("a bare URL redirects to the English prefix", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test(
    "switching to BM changes the URL and the copy",
    async ({ page }) => {
      await page.goto("/en/login");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

      // The buttons show "EN"/"BM" but carry the full language as their
      // accessible name, so that is what getByRole matches on.
      await page.getByRole("button", { name: "Bahasa Melayu" }).click();

      await expect(page).toHaveURL(/\/ms\/login/);
      await expect(page.getByRole("heading", { name: "Log Masuk" })).toBeVisible();
    },
  );

  test("the choice survives a reload", async ({ page }) => {
    await page.goto("/en/login");
    await page.getByRole("button", { name: "Bahasa Melayu" }).click();
    await expect(page).toHaveURL(/\/ms\/login/);

    // A bare URL now resolves through the cookie, not the default.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/ms\/login/);
  });

  test("switching keeps the user on the same page", async ({ page }) => {
    await page.goto("/en/buyer_portal/ayam-norliza-pilot/login");
    await page.getByRole("button", { name: "Bahasa Melayu" }).click();
    await expect(page).toHaveURL(
      /\/ms\/buyer_portal\/ayam-norliza-pilot\/login/,
    );
  });
});
