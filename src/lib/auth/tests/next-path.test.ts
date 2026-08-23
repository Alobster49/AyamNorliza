/**
 * Unit tests for `sanitizeNextPath`.
 *
 * The `?next=` value ends up in `router.push()` and in Location headers, and
 * it arrives from the query string, so these cases are the security boundary
 * for the post-login redirect - not stylistic checks.
 */

import { describe, expect, it } from "vitest";

import { sanitizeNextPath, toLocaleAgnostic } from "../next-path";

describe("sanitizeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(sanitizeNextPath("/ayam-norliza-pilot/orders")).toBe(
      "/ayam-norliza-pilot/orders",
    );
  });

  it("keeps the query string so filters survive the round trip", () => {
    expect(sanitizeNextPath("/acme/orders?status=open&page=2")).toBe(
      "/acme/orders?status=open&page=2",
    );
  });

  it("keeps the invite deep link the invite page relies on", () => {
    expect(sanitizeNextPath("/invite/abc123")).toBe("/invite/abc123");
  });

  it.each([null, undefined, ""])("rejects %s", (value) => {
    expect(sanitizeNextPath(value)).toBeNull();
  });

  it.each([
    ["absolute http URL", "https://evil.com/steal"],
    ["protocol-relative URL", "//evil.com"],
    ["backslash protocol-relative URL", "/\\evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>"],
    ["bare relative path", "orders"],
  ])("rejects an off-site destination: %s", (_label, value) => {
    expect(sanitizeNextPath(value)).toBeNull();
  });

  it.each([
    ["newline", "/\nhttps://evil.com"],
    ["tab", "/\t/evil.com"],
    ["carriage return", "/\r//evil.com"],
    ["null byte", "/\u0000//evil.com"],
  ])("rejects control characters that browsers strip: %s", (_label, value) => {
    expect(sanitizeNextPath(value)).toBeNull();
  });

  it.each(["/login", "/login?error=x", "/signup", "/mfa", "/auth/callback"])(
    "rejects the auth route %s, which would bounce the user straight back out",
    (value) => {
      expect(sanitizeNextPath(value)).toBeNull();
    },
  );

  it("does not reject a path that merely starts with an auth path's name", () => {
    expect(sanitizeNextPath("/loginville/orders")).toBe("/loginville/orders");
  });

  it("keeps a locale-prefixed application path intact", () => {
    expect(sanitizeNextPath("/en/acme/orders/123")).toBe("/en/acme/orders/123");
  });

  it("keeps the query string on a locale-prefixed path", () => {
    expect(sanitizeNextPath("/en/acme/orders?status=open")).toBe(
      "/en/acme/orders?status=open",
    );
  });

  it.each(["/en/login", "/ms/signup", "/en/mfa", "/ms/auth/callback"])(
    "rejects the locale-prefixed auth route %s so sign-in cannot loop",
    (value) => {
      expect(sanitizeNextPath(value)).toBeNull();
    },
  );
});

// `stripLocalePrefix` itself now lives, and is tested, in
// `src/lib/i18n/strip-locale-prefix.test.ts` - it is a purely locale-shaped
// helper, not an auth concern.

describe("toLocaleAgnostic", () => {
  it("validates and strips the locale prefix in one step", () => {
    expect(toLocaleAgnostic("/ms/acme/orders")).toBe("/acme/orders");
  });

  it("returns null for a value sanitizeNextPath would reject", () => {
    expect(toLocaleAgnostic("//evil.com")).toBeNull();
    expect(toLocaleAgnostic(null)).toBeNull();
    expect(toLocaleAgnostic(undefined)).toBeNull();
  });

  it("rejects an auth path regardless of locale prefix", () => {
    expect(toLocaleAgnostic("/ms/login")).toBeNull();
  });

  it("rejects a value that becomes protocol-relative once the locale prefix is stripped", () => {
    // "/en//evil.com" passes sanitizeNextPath (it starts "/e", not "//"), but
    // stripping "/en" leaves "//evil.com" - the exact protocol-relative form
    // sanitizeNextPath exists to reject.
    expect(toLocaleAgnostic("/en//evil.com")).toBeNull();
    expect(toLocaleAgnostic("/en/\\evil.com")).toBeNull();
  });
});
