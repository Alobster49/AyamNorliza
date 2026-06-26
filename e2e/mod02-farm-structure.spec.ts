import { expect, test } from "@playwright/test";
import { OWNER, signIn } from "./_fixtures";

test("owner creates farm hierarchy and generates a house label", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const siteCode = `E2E${suffix}`;
  const zoneCode = `Z${suffix}`;
  const houseCode = `H${suffix}`;
  const storageCode = `S${suffix}`;

  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/settings/sites");

  await page.getByLabel(/^name$/i).fill(`E2E Farm ${suffix}`);
  await page.getByLabel(/^code$/i).fill(siteCode);
  await page.getByLabel(/time zone/i).fill("Asia/Kuala_Lumpur");
  await page.getByRole("button", { name: /create site/i }).click();
  await expect(page.getByRole("cell", { name: siteCode })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("row", { name: new RegExp(siteCode) }).getByRole("link", { name: /open/i }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`E2E Farm ${suffix}`) })).toBeVisible();

  await page.getByLabel(/^name$/i).nth(0).fill(`Zone ${suffix}`);
  await page.getByLabel(/^code$/i).nth(0).fill(zoneCode);
  await page.getByRole("button", { name: /add zone/i }).click();
  await expect(page.getByRole("cell", { name: zoneCode })).toBeVisible({ timeout: 10_000 });

  await page.getByLabel(/^name$/i).nth(1).fill(`House ${suffix}`);
  await page.getByLabel(/^code$/i).nth(1).fill(houseCode);
  await page.getByLabel(/capacity/i).fill("2500");
  await page.getByRole("button", { name: /add house/i }).click();
  await expect(page.getByRole("cell", { name: houseCode })).toBeVisible({ timeout: 10_000 });

  await page.getByLabel(/^name$/i).nth(2).fill(`Feed store ${suffix}`);
  await page.getByLabel(/^code$/i).nth(2).fill(storageCode);
  await page.getByRole("button", { name: /add storage/i }).click();
  await expect(page.getByRole("cell", { name: storageCode })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("row", { name: new RegExp(houseCode) }).getByRole("link", { name: /open/i }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`House ${suffix}`) })).toBeVisible();
  const houseId = page.url().split("/").at(-1);
  expect(houseId).toMatch(/[0-9a-f-]{36}/);

  await page.goto("/ayam-norliza-pilot/settings/labels");
  await page.getByLabel(/entity id/i).fill(houseId!);
  await page.getByLabel(/entity code/i).fill(houseCode);
  await page.getByRole("button", { name: /generate label/i }).click();
  await expect(page.getByRole("cell", { name: new RegExp(`HOUSE-${houseCode}`) })).toBeVisible({ timeout: 10_000 });
  const labelHref = await page.getByRole("row", { name: new RegExp(`HOUSE-${houseCode}`) }).getByRole("link", { name: /open/i }).getAttribute("href");
  expect(labelHref).toMatch(new RegExp(`/labels/ANP-HOUSE-${houseCode}`));
  const labelResponse = await page.goto(labelHref!);
  expect(labelResponse?.ok()).toBe(true);
  expect(labelResponse?.headers()["content-type"]).toContain("image/svg+xml");
  await expect(labelResponse!.text()).resolves.toContain("<svg");
});
