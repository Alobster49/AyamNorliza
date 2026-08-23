import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";

/** Visits every leaf of a catalog tree. A leaf is anything that is not a
 *  non-empty plain object: strings, numbers, arrays, null, and `{}`. */
function walkLeaves(
  value: unknown,
  visit: (keyPath: string, leaf: unknown) => void,
  prefix = "",
): void {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    visit(prefix, value);
    return;
  }

  // typeof value === "object" and value !== null and !Array.isArray(value)
  // So it's a plain object
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    // Empty object is a leaf
    visit(prefix, value);
    return;
  }

  // Non-empty object: recurse
  for (const [key, child] of entries) {
    walkLeaves(child, visit, prefix ? `${prefix}.${key}` : key);
  }
}

/** Flattens {a: {b: "x"}} to ["a.b"] so the diff names the exact missing key. */
function flattenKeys(value: unknown, prefix = ""): string[] {
  const keys: string[] = [];
  walkLeaves(value, (keyPath) => keys.push(keyPath), prefix);
  return keys;
}

/** Walks the entire tree and returns [keyPath, leaf] for every string leaf.
 * Carries the leaf string along to check for empty values. */
function flattenValues(value: unknown, prefix = ""): Array<[string, string]> {
  const values: Array<[string, string]> = [];
  walkLeaves(value, (keyPath, leaf) => {
    if (typeof leaf === "string") {
      values.push([keyPath, leaf]);
    }
  }, prefix);
  return values;
}

/** Walks the entire tree and returns [keyPath, typeofValue] for every leaf, including non-strings.
 * Catches drifts where a key holds a string in one catalog but an array/number/boolean in another. */
function flattenLeafTypes(value: unknown, prefix = ""): Array<[string, string]> {
  const types: Array<[string, string]> = [];
  walkLeaves(value, (keyPath, leaf) => {
    let typeName: string;
    if (Array.isArray(leaf)) {
      typeName = "array";
    } else if (leaf === null) {
      typeName = "null";
    } else if (typeof leaf === "object" && Object.keys(leaf as Record<string, unknown>).length === 0) {
      typeName = "empty-object";
    } else {
      typeName = typeof leaf;
    }
    types.push([keyPath, typeName]);
  }, prefix);
  return types;
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
