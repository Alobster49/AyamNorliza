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
