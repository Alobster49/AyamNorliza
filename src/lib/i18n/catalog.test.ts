import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";

/** Flattens {a: {b: "x"}} to ["a.b"] so the diff names the exact missing key. */
function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs", () => {
  const enKeys = flattenKeys(en).sort();
  const msKeys = flattenKeys(ms).sort();

  it("ms has no missing keys", () => {
    expect(enKeys.filter((key) => !msKeys.includes(key))).toEqual([]);
  });

  it("ms has no extra keys", () => {
    expect(msKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it("has no empty string values in either catalog", () => {
    const empties = [
      ...flattenValues(en).filter(([, v]) => v.trim() === "").map(([k]) => `en:${k}`),
      ...flattenValues(ms).filter(([, v]) => v.trim() === "").map(([k]) => `ms:${k}`),
    ];
    expect(empties).toEqual([]);
  });
});

/** Same walk as flattenKeys, but carries the leaf string along. */
function flattenValues(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix, value]];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenValues(child, prefix ? `${prefix}.${key}` : key),
  );
}
