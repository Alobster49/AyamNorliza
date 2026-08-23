export type CheckoutStage = "account" | "address" | "slot" | "ready";

export type StageInput = {
  isAuthed: boolean;
  accountValid: boolean;
  addressValid: boolean;
  zoneResolved: boolean;
  slotSelected: boolean;
};

/** The narrating CTA: the button label always names the NEXT thing needed. */
export function checkoutStage(i: StageInput): CheckoutStage {
  if (!i.isAuthed && !i.accountValid) return "account";
  if (!i.addressValid || !i.zoneResolved) return "address";
  if (!i.slotSelected) return "slot";
  return "ready";
}

export const STAGE_CTA: Record<CheckoutStage, string> = {
  account: "Isi akaun anda",
  address: "Pilih alamat",
  slot: "Pilih slot penghantaran",
  ready: "Hantar pesanan",
};
