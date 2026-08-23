import { describe, expect, it } from "vitest";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  resolveLocaleFromSources,
} from "./cookie";

describe("locale cookie constants", () => {
  it("uses the cookie name next-intl reads", () => {
    expect(LOCALE_COOKIE_NAME).toBe("NEXT_LOCALE");
  });

  it("lasts a year", () => {
    expect(LOCALE_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});

describe("resolveLocaleFromSources", () => {
  it("prefers the URL over everything", () => {
    expect(
      resolveLocaleFromSources({
        urlLocale: "ms",
        cookieLocale: "en",
        dbLocale: "en",
      }),
    ).toBe("ms");
  });

  it("falls back to the cookie when there is no URL locale", () => {
    expect(
      resolveLocaleFromSources({ cookieLocale: "ms", dbLocale: "en" }),
    ).toBe("ms");
  });

  it("falls back to the database when there is no cookie", () => {
    expect(resolveLocaleFromSources({ dbLocale: "ms" })).toBe("ms");
  });

  it("falls back to en when nothing is set", () => {
    expect(resolveLocaleFromSources({})).toBe("en");
  });

  it("ignores unsupported values at every level", () => {
    expect(
      resolveLocaleFromSources({
        urlLocale: "de",
        cookieLocale: "fr",
        dbLocale: "ms",
      }),
    ).toBe("ms");
  });
});
