import { expect, test } from "@playwright/test";
import { OWNER } from "./_fixtures";

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

  test(
    "a locale-prefixed ?next= survives sign-in without doubling the locale",
    async ({ page }) => {
      // `next` is URL-encoded and already carries a locale prefix, the way
      // an expired-session redirect (`requireUserOrRedirect`) or a crafted
      // link would produce it. `login-form.tsx`'s router is the i18n-aware
      // one, which adds its own prefix unconditionally under
      // `localePrefix: 'always'` - if `toLocaleAgnostic` (or the
      // `sanitizeNextPath` + `stripLocalePrefix` pair it replaced) is ever
      // skipped or misordered on this seam, the result is "/ms/ms/...".
      const destination = "/ms/ayam-norliza-pilot/orders";
      await page.goto(`/ms/login?next=${encodeURIComponent(destination)}`);

      await page.getByLabel(/emel/i).fill(OWNER.email);
      await page.getByLabel(/kata laluan/i).fill(OWNER.password);
      await page.getByRole("button", { name: "Log Masuk" }).click();

      await expect(page).toHaveURL(/\/ms\/ayam-norliza-pilot\/orders(?:[/?#]|$)/, {
        timeout: 10_000,
      });
      // Belt and braces: the regex above already anchors on a single "/ms/"
      // prefix, but assert the doubled-up form is absent explicitly so a
      // future loosening of that regex cannot hide the regression.
      expect(new URL(page.url()).pathname).not.toMatch(/^\/ms\/ms\//);
    },
  );
});
