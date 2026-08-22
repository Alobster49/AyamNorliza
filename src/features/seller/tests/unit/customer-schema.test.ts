import { describe, expect, test } from "vitest";
import { parseCustomerEmail } from "../../lib/customer-schema";

describe("parseCustomerEmail", () => {
  test("null and undefined pass through as null", () => {
    expect(parseCustomerEmail(null)).toBeNull();
    expect(parseCustomerEmail(undefined)).toBeNull();
  });

  test("empty and whitespace-only strings become null", () => {
    expect(parseCustomerEmail("")).toBeNull();
    expect(parseCustomerEmail("   ")).toBeNull();
  });

  test("valid email is trimmed and returned", () => {
    expect(parseCustomerEmail("  kak.ros@example.my ")).toBe("kak.ros@example.my");
  });

  test("invalid email throws", () => {
    expect(() => parseCustomerEmail("not-an-email")).toThrow("Invalid email address");
    expect(() => parseCustomerEmail(42)).toThrow("Invalid email address");
  });
});
