import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
} from "./locales";

describe("locales", () => {
  it("supports exactly en and ms", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "ms"]);
  });

  it("defaults to en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("accepts supported locales", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("ms")).toBe(true);
  });

  it("rejects anything else, including near-misses and non-strings", () => {
    expect(isSupportedLocale("EN")).toBe(false);
    expect(isSupportedLocale("en-US")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });

  it("has a label for every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
      expect(LOCALE_SHORT_LABELS[locale]).toBeTruthy();
    }
  });
});
