import { describe, expect, it } from "vitest";
import {
  CONSOLE_ACCOUNTS,
  CONSOLE_DRIVER_EMAILS,
  REALWORLD_DRIVER_ACCOUNTS,
} from "../../lib/accounts";

describe("CONSOLE_ACCOUNTS", () => {
  it("declares one login per role the app gates on", () => {
    expect(CONSOLE_ACCOUNTS).toEqual([
      { email: "owner@gmail.com", displayName: "CEO Badrol", role: "owner" },
      { email: "admin@gmail.com", displayName: "Hafiz Samad", role: "org_admin" },
      { email: "seller@gmail.com", displayName: "Seller", role: "seller" },
      { email: "warehouse@gmail.com", displayName: "Warehouse", role: "inventory" },
      { email: "driver1@gmail.com", displayName: "Driver One", role: "driver" },
      { email: "driver2@gmail.com", displayName: "Driver Two", role: "driver" },
    ]);
  });

  it("uses a distinct email per account", () => {
    const emails = CONSOLE_ACCOUNTS.map((a) => a.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("exposes both drivers, in seed order, for run assignment", () => {
    expect(CONSOLE_DRIVER_EMAILS).toEqual([
      "driver1@gmail.com",
      "driver2@gmail.com",
    ]);
  });
});

describe("REALWORLD_DRIVER_ACCOUNTS", () => {
  it("fields exactly 30 drivers, driver<N> on truck JHR-<N>", () => {
    expect(REALWORLD_DRIVER_ACCOUNTS).toHaveLength(30);
    for (const [i, driver] of REALWORLD_DRIVER_ACCOUNTS.entries()) {
      const n = i + 1;
      expect(driver.email).toBe(`driver${n}@gmail.com`);
      expect(driver.truckCode).toBe(`JHR-${String(n).padStart(2, "0")}`);
      expect(driver.role).toBe("driver");
    }
  });

  it("gives every driver a distinct display name", () => {
    const names = REALWORLD_DRIVER_ACCOUNTS.map((d) => d.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the demo drivers' emails as a strict prefix, so the two seeds share logins", () => {
    expect(REALWORLD_DRIVER_ACCOUNTS.slice(0, 2).map((d) => d.email)).toEqual(
      CONSOLE_DRIVER_EMAILS,
    );
  });
});
