import { describe, expect, it } from "vitest";

import { stripLocalePrefix } from "./strip-locale-prefix";

describe("stripLocalePrefix", () => {
  it("drops the locale segment", () => {
    expect(stripLocalePrefix("/en/acme/orders")).toBe("/acme/orders");
    expect(stripLocalePrefix("/ms/acme/orders")).toBe("/acme/orders");
  });

  it("returns '/' for a bare locale root", () => {
    expect(stripLocalePrefix("/en")).toBe("/");
    expect(stripLocalePrefix("/ms/")).toBe("/");
  });

  it("leaves an unprefixed path untouched", () => {
    expect(stripLocalePrefix("/acme/orders")).toBe("/acme/orders");
  });

  it("leaves a path alone when the first segment merely looks like a locale", () => {
    expect(stripLocalePrefix("/english/orders")).toBe("/english/orders");
  });

  it("splits the query off before checking the first segment, so a query on the locale root does not get treated as part of it", () => {
    // Regression: splitting on "/" without removing the query first sees
    // the first segment as "en?foo=1", matches no locale, and returns the
    // value unchanged - a caller that then re-prefixes it produces
    // "/en/en?foo=1".
    expect(stripLocalePrefix("/en?foo=1")).toBe("/?foo=1");
  });

  it("keeps a query string on a non-root prefixed path", () => {
    expect(stripLocalePrefix("/en/acme/orders?status=open")).toBe(
      "/acme/orders?status=open",
    );
  });
});
