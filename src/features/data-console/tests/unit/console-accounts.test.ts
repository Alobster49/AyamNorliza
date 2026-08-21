import { describe, expect, it } from "vitest";
import { CONSOLE_ACCOUNTS } from "../../lib/accounts";

describe("CONSOLE_ACCOUNTS", () => {
  it("declares exactly the two console logins from the spec", () => {
    expect(CONSOLE_ACCOUNTS).toEqual([
      { email: "badrol@gmail.com", displayName: "Badrol", role: "owner" },
      { email: "hafizzudinsamad@gmail.com", displayName: "Hafizzudin Samad", role: "org_admin" },
    ]);
  });
});
