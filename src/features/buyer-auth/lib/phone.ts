/**
 * Malaysian mobile phone normalization for buyer signup. Stored E.164
 * (+601XXXXXXXX) so future WhatsApp messaging needs no reformatting.
 */

/** Returns +601XXXXXXXX (E.164) or null when not a Malaysian mobile. */
export function normalizeMalaysianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  let national: string;
  if (digits.startsWith("60")) {
    national = "0" + digits.slice(2).replace(/^0/, "");
  } else {
    national = digits;
  }
  // Malaysian mobiles: 01X followed by 7-8 digits (10-11 digits total).
  if (!/^01[0-9]{8,9}$/.test(national)) return null;
  return "+60" + national.slice(1);
}
