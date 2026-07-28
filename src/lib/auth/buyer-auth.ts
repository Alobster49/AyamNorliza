/**
 * Buyer authentication guards for Server Components and Server Actions.
 */

import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class NotABuyerError extends Error {
  readonly code = "not_a_buyer";
  constructor(message = "User is not a buyer") {
    super(message);
    this.name = "NotABuyerError";
  }
}

export type Buyer = {
  id: string;
  organization_id: string;
  display_name: string;
  address: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export async function requireBuyer() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new NotABuyerError("Not authenticated");
  }

  // Check if user has a buyer record
  const { data: buyer, error: buyerError } = await supabase
    .from("buyers")
    .select("*")
    .eq("id", user.id)
    .single();

  if (buyerError || !buyer) {
    throw new NotABuyerError("Not registered as a buyer");
  }

  return buyer as Buyer;
}

/**
 * For Server Components that need to redirect if not authenticated.
 */
export async function requireBuyerOrRedirect(organizationSlug: string) {
  try {
    return await requireBuyer();
  } catch (err) {
    if (err instanceof NotABuyerError) {
      redirect(`/${organizationSlug}/login`);
    }
    throw err;
  }
}

/**
 * Check if current user is a buyer (returns null if not).
 */
export async function getBuyerFromSession(): Promise<Buyer | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: buyer } = await supabase
    .from("buyers")
    .select("*")
    .eq("id", user.id)
    .single();

  return buyer as Buyer | null;
}
