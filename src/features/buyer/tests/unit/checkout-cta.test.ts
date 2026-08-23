import { describe, expect, it } from "vitest";
import { checkoutStage, STAGE_CTA } from "@/features/buyer/lib/checkout-cta";

const base = { isAuthed: false, accountValid: false, addressValid: false, zoneResolved: false, slotSelected: false };

describe("checkoutStage", () => {
  it("anonymous with empty account form → account", () => {
    expect(checkoutStage(base)).toBe("account");
  });
  it("anonymous with valid account fields advances to address", () => {
    expect(checkoutStage({ ...base, accountValid: true })).toBe("address");
  });
  it("signed-in skips account", () => {
    expect(checkoutStage({ ...base, isAuthed: true })).toBe("address");
  });
  it("address valid but zone unresolved stays address", () => {
    expect(checkoutStage({ ...base, isAuthed: true, addressValid: true })).toBe("address");
  });
  it("zone resolved → slot", () => {
    expect(checkoutStage({ ...base, isAuthed: true, addressValid: true, zoneResolved: true })).toBe("slot");
  });
  it("slot selected → ready", () => {
    expect(
      checkoutStage({ ...base, isAuthed: true, addressValid: true, zoneResolved: true, slotSelected: true }),
    ).toBe("ready");
  });
  it("CTA copy per stage", () => {
    expect(STAGE_CTA.account).toBe("Isi akaun anda");
    expect(STAGE_CTA.address).toBe("Pilih alamat");
    expect(STAGE_CTA.slot).toBe("Pilih slot penghantaran");
    expect(STAGE_CTA.ready).toBe("Hantar pesanan");
  });
});
