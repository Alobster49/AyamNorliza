import { z } from "zod";

const EmailSchema = z.string().email().max(254);

/**
 * Optional-email parsing for the customer dialog: blank means "no email",
 * anything non-blank must be a valid address.
 */
export function parseCustomerEmail(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new Error("Invalid email address");
  const value = raw.trim();
  if (value === "") return null;
  const parsed = EmailSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid email address");
  return parsed.data;
}

export type CustomerAddressInput = {
  address?: unknown;
  postcode?: unknown;
  state?: unknown;
  area?: unknown;
};

export type CustomerAddressParts = {
  address: string | null;
  postcode: string | null;
  state: string | null;
  area: string | null;
};

function trimmedOrNull(raw: unknown, label: string): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new Error(`Invalid ${label}`);
  const value = raw.trim();
  return value === "" ? null : value;
}

/**
 * All-or-nothing address parsing for the customer forms: leave the whole
 * block blank, or fill it in. State and area always arrive together because
 * the postcode lookup supplies both. The database is deliberately looser —
 * it tolerates legacy address-only rows the backfill could not resolve.
 */
export function parseCustomerAddress(input: CustomerAddressInput): CustomerAddressParts {
  const address = trimmedOrNull(input.address, "address");
  const postcode = trimmedOrNull(input.postcode, "postcode");
  const state = trimmedOrNull(input.state, "state");
  const area = trimmedOrNull(input.area, "area");

  if (!address && !postcode && !state && !area) {
    return { address: null, postcode: null, state: null, area: null };
  }
  if (address && !postcode) {
    throw new Error("Enter a 5-digit postcode for this address");
  }
  if (postcode && !address) {
    throw new Error("Enter an address for this postcode");
  }
  if (postcode && !/^[0-9]{5}$/.test(postcode)) {
    throw new Error("Enter a valid 5-digit postcode");
  }
  if (Boolean(state) !== Boolean(area)) {
    throw new Error("Pick both a state and an area");
  }

  return { address, postcode, state, area };
}
