import { describe, expect, it } from "vitest";

import { isRouteActive } from "./route-active";

describe("isRouteActive", () => {
  it("matches an exact unprefixed path", () => {
    expect(isRouteActive("/acme/orders", "/acme/orders")).toBe(true);
  });

  it("matches a nested unprefixed path", () => {
    expect(isRouteActive("/acme/orders/123", "/acme/orders")).toBe(true);
  });

  it("does not match a sibling path that merely shares a prefix", () => {
    expect(isRouteActive("/acme/orders-archive", "/acme/orders")).toBe(false);
  });

  it("strips a locale prefix before comparing", () => {
    expect(isRouteActive("/en/acme/orders/123", "/acme/orders")).toBe(true);
    expect(isRouteActive("/ms/acme/orders", "/acme/orders")).toBe(true);
  });

  it("does not match an unrelated path", () => {
    expect(isRouteActive("/acme/customers", "/acme/orders")).toBe(false);
  });
});
