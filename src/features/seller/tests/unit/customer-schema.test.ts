import { describe, expect, test } from "vitest";
import { parseCustomerAddress, parseCustomerEmail } from "../../lib/customer-schema";

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

describe("parseCustomerAddress", () => {
  test("an entirely blank address parses to all nulls", () => {
    expect(parseCustomerAddress({})).toEqual({
      address: null,
      postcode: null,
      state: null,
      area: null,
    });
    expect(
      parseCustomerAddress({ address: "  ", postcode: "", state: null, area: undefined }),
    ).toEqual({ address: null, postcode: null, state: null, area: null });
  });

  test("a complete address is trimmed and returned", () => {
    expect(
      parseCustomerAddress({
        address: "  1 Jalan Penuh ",
        postcode: " 80000 ",
        state: " Johor ",
        area: " Johor Bahru ",
      }),
    ).toEqual({
      address: "1 Jalan Penuh",
      postcode: "80000",
      state: "Johor",
      area: "Johor Bahru",
    });
  });

  test("an address without a postcode throws", () => {
    expect(() => parseCustomerAddress({ address: "9 Jalan Tanpa Poskod" })).toThrow(
      "Enter a 5-digit postcode for this address",
    );
  });

  test("a postcode without an address throws", () => {
    expect(() => parseCustomerAddress({ postcode: "80000" })).toThrow(
      "Enter an address for this postcode",
    );
  });

  test("a malformed postcode throws", () => {
    expect(() =>
      parseCustomerAddress({ address: "4 Jalan Salah", postcode: "8000" }),
    ).toThrow("Enter a valid 5-digit postcode");
  });

  test("a state without an area throws", () => {
    expect(() =>
      parseCustomerAddress({
        address: "2 Jalan Separa",
        postcode: "80000",
        state: "Johor",
      }),
    ).toThrow("Pick both a state and an area");
  });

  test("a non-string address field throws", () => {
    expect(() => parseCustomerAddress({ address: 42 })).toThrow("Invalid address");
  });
});
