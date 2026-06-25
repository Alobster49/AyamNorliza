import { expect, test } from "@playwright/test";

test("visitor can switch between dark and light mode", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("button", { name: /change color theme/i }).click();
  await page.getByRole("menuitem", { name: /^dark$/i }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("theme")))
    .toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: /change color theme/i }).click();
  await page.getByRole("menuitem", { name: /^light$/i }).click();

  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("theme")))
    .toBe("light");
});
