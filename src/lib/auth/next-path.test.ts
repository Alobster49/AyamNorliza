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

describe("sanitizeNextPath + stripLocalePrefix feeding the i18n router", () => {
  /**
   * `next` arrives already prefixed (it is built from the request path), and
   * `sanitizeNextPath` deliberately keeps that prefix. But the login form and
   * the MFA card hand the result to next-intl's router, whose `push`/
   * `replace` add their own prefix unconditionally under
   * `localePrefix: 'always'`. Feeding the sanitized value straight through
   * doubles the prefix ("/ms/ms/...") and 404s. This pins the fix: strip the
   * prefix before simulating what the i18n router does to it.
   */
  function pushThroughI18nRouter(path: string, locale: "en" | "ms"): string {
    // Mirrors next-intl's `localePrefix: 'always'` behaviour: it always
    // prepends the active locale, regardless of what the path starts with.
    return path === "/" ? `/${locale}` : `/${locale}${path}`;
  }

  it("carries exactly one locale prefix after sanitize -> strip -> i18n router push", () => {
    const next = "/ms/ayam-norliza-pilot/orders/123";
    const sanitized = sanitizeNextPath(next);
    expect(sanitized).toBe(next);

    const stripped = stripLocalePrefix(sanitized as string);
    expect(stripped).toBe("/ayam-norliza-pilot/orders/123");

    const pushed = pushThroughI18nRouter(stripped, "ms");
    expect(pushed).toBe("/ms/ayam-norliza-pilot/orders/123");
    expect(pushed.match(/^\/ms(\/ms)+/)).toBeNull();
  });

  it("would double the prefix if the sanitized value were pushed unstripped", () => {
    const next = "/ms/ayam-norliza-pilot/orders/123";
    const sanitized = sanitizeNextPath(next) as string;
    const pushedWithoutStripping = pushThroughI18nRouter(sanitized, "ms");
    expect(pushedWithoutStripping).toBe(
      "/ms/ms/ayam-norliza-pilot/orders/123",
    );
  });
});
