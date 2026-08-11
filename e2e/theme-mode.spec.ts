import { expect, test } from "@playwright/test";

test("visitor can switch between dark and light mode", async ({ page }) => {
  await page.goto("/login");

  // The theme control is a single toggle button (see ThemeToggle): it flips
  // between dark and light rather than opening a menu of choices.
  const toggle = page.getByRole("button", { name: /toggle color theme/i });

  await toggle.click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("theme")))
    .toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await toggle.click();

  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("theme")))
    .toBe("light");
});
