import { describe, expect, it } from "vitest";
import { CONSOLE_ACCOUNTS, CONSOLE_DRIVER_EMAILS } from "../../lib/accounts";

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
