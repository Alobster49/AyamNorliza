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

  it("has only string values at every leaf (no arrays, numbers, booleans)", () => {
    const nonStrings = [
      ...flattenLeafTypes(en).filter(([, type]) => type !== "string").map(([k, type]) => `en:${k} (${type})`),
      ...flattenLeafTypes(ms).filter(([, type]) => type !== "string").map(([k, type]) => `ms:${k} (${type})`),
    ];
    expect(nonStrings).toEqual([]);
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

/** Walks the entire tree and returns [keyPath, typeofValue] for every leaf, including non-strings.
 * Catches drifts where a key holds a string in one catalog but an array/number/boolean in another. */
function flattenLeafTypes(value: unknown, prefix = ""): Array<[string, string]> {
  if (value === null || typeof value !== "object") {
    return [[prefix, typeof value]];
  }
  if (Array.isArray(value)) {
    return [[prefix, "object"]];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return [[prefix, "object"]];
  }
  return entries.flatMap(([key, child]) =>
    flattenLeafTypes(child, prefix ? `${prefix}.${key}` : key),
  );
}
