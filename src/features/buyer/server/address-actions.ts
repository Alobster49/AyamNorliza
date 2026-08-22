/**
 * Buyer address book Server Actions. All rows are RLS-scoped to the
 * signed-in buyer (buyer_id = auth.uid()); the default flag is kept
 * unique per buyer by a partial unique index, so every default change
 * first clears the old default in the same action.
 */

"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import type { ActionResult } from "@/features/identity-access/server/actions";
import type { BuyerAddress } from "../types";

type AddressErrorCode = "validation" | "unauthenticated" | "not_found" | "internal";

function err<T = never>(
  code: AddressErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

type AddressRow = {
  id: string;
  address_line: string;
  postcode: string;
  state: string;
  area: string;
  is_default: boolean;
  created_at: string;
};

function mapRow(row: AddressRow): BuyerAddress {
  return {
    id: row.id,
    addressLine: row.address_line,
    postcode: row.postcode,
    state: row.state,
    area: row.area,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

const CreateAddressInput = z.object({
  addressLine: z.string().min(1).max(500),
  postcode: z.string().regex(/^[0-9]{5}$/, "Enter a 5-digit postcode"),
  state: z.string().min(1).max(50),
  area: z.string().min(1).max(100),
  makeDefault: z.boolean().optional(),
});

const AddressId = z.string().uuid();

async function guard(): Promise<{ buyerId: string } | ActionResult<never>> {
  try {
    const buyer = await requireBuyer();
    return { buyerId: buyer.id };
  } catch (e) {
    if (e instanceof NotABuyerError) return err("unauthenticated", e.message);
    throw e;
  }
}

export async function listMyAddresses(): Promise<ActionResult<BuyerAddress[]>> {
  const g = await guard();
  if ("ok" in g) return g;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("buyer_addresses")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return err("internal", "Failed to load addresses");
  return ok(((data ?? []) as AddressRow[]).map(mapRow));
}

export async function createAddress(
  rawInput: unknown,
): Promise<ActionResult<BuyerAddress>> {
  const parsed = CreateAddressInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid address", parsed.error.flatten().fieldErrors);
  }
  const g = await guard();
  if ("ok" in g) return g;
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  const { count } = await supabase
    .from("buyer_addresses")
    .select("id", { count: "exact", head: true });
  const makeDefault = input.makeDefault || !count;

  if (makeDefault && count) {
    await supabase.from("buyer_addresses").update({ is_default: false }).eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("buyer_addresses")
    .insert({
      buyer_id: g.buyerId,
      address_line: input.addressLine,
      postcode: input.postcode,
      state: input.state,
      area: input.area,
      is_default: makeDefault,
    })
    .select("*")
    .single();

  if (error || !data) return err("internal", "Failed to save address");
  return ok(mapRow(data as AddressRow));
}

export async function setDefaultAddress(
  addressId: string,
): Promise<ActionResult<BuyerAddress>> {
  if (!AddressId.safeParse(addressId).success) {
    return err("validation", "Invalid address id");
  }
  const g = await guard();
  if ("ok" in g) return g;

  const supabase = await createSupabaseServerClient();
  await supabase.from("buyer_addresses").update({ is_default: false }).eq("is_default", true);
  const { data, error } = await supabase
    .from("buyer_addresses")
    .update({ is_default: true })
    .eq("id", addressId)
    .select("*")
    .single();

  if (error || !data) return err("not_found", "Address not found");
  return ok(mapRow(data as AddressRow));
}

export async function deleteAddress(
  addressId: string,
): Promise<ActionResult<{ deletedId: string }>> {
  if (!AddressId.safeParse(addressId).success) {
    return err("validation", "Invalid address id");
  }
  const g = await guard();
  if ("ok" in g) return g;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("buyer_addresses")
    .delete()
    .eq("id", addressId)
    .select("id, is_default");

  if (error) return err("internal", "Failed to delete address");
  const deleted = (data ?? [])[0] as { id: string; is_default: boolean } | undefined;
  if (!deleted) return err("not_found", "Address not found");

  if (deleted.is_default) {
    // Promote the oldest remaining address, if any.
    const { data: oldest } = await supabase
      .from("buyer_addresses")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldest) {
      await supabase.from("buyer_addresses").update({ is_default: true }).eq("id", oldest.id);
    }
  }

  return ok({ deletedId: deleted.id });
}
