/**
 * Buyer authentication Server Actions.
 * Handles signup, signin, and signout for the buyer portal.
 */

"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/identity-access/server/actions";

type AuthErrorCode = "validation" | "unauthenticated" | "internal" | "conflict";

function err<T = never>(
  code: AuthErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

const BuyerSignupInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(150),
  organizationSlug: z.string().min(1).max(100),
});

export async function buyerSignUpAction(
  rawInput: unknown,
): Promise<ActionResult<{ buyerId: string }>> {
  const parsed = BuyerSignupInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid signup", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Get organization ID from slug
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", input.organizationSlug)
    .single();

  if (orgError || !org) {
    return err("validation", "Invalid organization");
  }

  // Sign up the user with Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { display_name: input.displayName },
    },
  });

  if (error) {
    return err("conflict", error.message);
  }

  if (!data.user) {
    return err("internal", "Failed to create user");
  }

  // Create buyer record
  const { error: buyerError } = await supabase.from("buyers").insert({
    id: data.user.id,
    organization_id: org.id,
    display_name: input.displayName,
  });

  if (buyerError) {
    // Rollback: delete the auth user
    await supabase.auth.admin.deleteUser(data.user.id);
    return err("internal", "Failed to create buyer profile");
  }

  return ok({ buyerId: data.user.id });
}

const BuyerLoginInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  organizationSlug: z.string().min(1).max(100).optional(),
});

export async function buyerSignInAction(
  rawInput: unknown,
): Promise<ActionResult<{ buyerId: string }>> {
  const parsed = BuyerLoginInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid login", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Sign in with Supabase Auth
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error || !data.user) {
    return err("unauthenticated", "Invalid email or password");
  }

  // Verify this is a buyer
  const { data: buyer, error: buyerError } = await supabase
    .from("buyers")
    .select("id, organization_id")
    .eq("id", data.user.id)
    .single();

  if (buyerError || !buyer) {
    await supabase.auth.signOut();
    return err("unauthenticated", "Not registered as a buyer");
  }

  // If organization slug was provided, verify it matches
  if (input.organizationSlug) {
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", input.organizationSlug)
      .single();

    if (!org || org.id !== buyer.organization_id) {
      await supabase.auth.signOut();
      return err("unauthenticated", "You are not a buyer for this organization");
    }
  }

  return ok({ buyerId: buyer.id });
}

export async function buyerSignOutAction(): Promise<ActionResult<{ ok: true }>> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return ok({ ok: true });
}
