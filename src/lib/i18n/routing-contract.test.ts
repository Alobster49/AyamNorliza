import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locales";

describe("routing config", () => {
  it("uses the shared locale list", () => {
    expect([...routing.locales]).toEqual([...SUPPORTED_LOCALES]);
  });

  it("uses the shared default locale", () => {
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE);
  });

  it("always prefixes the locale", () => {
    expect(routing.localePrefix).toBe("always");
  });
});
