import { describe, expect, it } from "vitest";
import { sanitizeNextPath, stripLocalePrefix } from "./next-path";

describe("stripLocalePrefix", () => {
  it("removes a supported locale prefix", () => {
    expect(stripLocalePrefix("/en/acme/orders")).toBe("/acme/orders");
    expect(stripLocalePrefix("/ms/acme/orders")).toBe("/acme/orders");
  });

  it("leaves the path alone when the first segment is not a locale", () => {
    expect(stripLocalePrefix("/acme/orders")).toBe("/acme/orders");
    expect(stripLocalePrefix("/english/orders")).toBe("/english/orders");
  });

  it("returns / for a bare locale root", () => {
    expect(stripLocalePrefix("/en")).toBe("/");
    expect(stripLocalePrefix("/ms/")).toBe("/");
  });
});

describe("sanitizeNextPath with locale prefixes", () => {
  it("keeps a prefixed application path intact", () => {
    expect(sanitizeNextPath("/en/acme/orders/123")).toBe("/en/acme/orders/123");
  });

  it("rejects a prefixed auth path so sign-in cannot loop", () => {
    expect(sanitizeNextPath("/en/login")).toBeNull();
    expect(sanitizeNextPath("/ms/signup")).toBeNull();
    expect(sanitizeNextPath("/en/mfa")).toBeNull();
    expect(sanitizeNextPath("/ms/auth/callback")).toBeNull();
  });

  it("still rejects unprefixed auth paths", () => {
    expect(sanitizeNextPath("/login")).toBeNull();
  });

  it("still rejects off-site and malformed values", () => {
    expect(sanitizeNextPath("//evil.com")).toBeNull();
    expect(sanitizeNextPath("/\\evil.com")).toBeNull();
    expect(sanitizeNextPath("https://evil.com")).toBeNull();
    expect(sanitizeNextPath("/en/orders\nHost: evil")).toBeNull();
    expect(sanitizeNextPath(null)).toBeNull();
  });

  it("preserves the query string", () => {
    expect(sanitizeNextPath("/en/acme/orders?status=open")).toBe(
      "/en/acme/orders?status=open",
    );
  });
});
