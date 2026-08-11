/**
 * Buyer portal server actions.
 * Handles catalog browsing, order management, and profile updates.
 */

"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/identity-access/server/actions";
import type {
  Buyer,
  Category,
  Product,
  ProductVariant,
  CatalogWithProducts,
} from "../types";

type CatalogErrorCode = "validation" | "not_found" | "internal" | "unauthenticated";

function err<T = never>(
  code: CatalogErrorCode,
  message: string,
): ActionResult<T> {
  return { ok: false, code, message };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Organization helpers
// ---------------------------------------------------------------------------

export async function getOrganizationBySlug(slug: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, slug, region")
    .eq("slug", slug)
    .single();
  return data;
}

// ---------------------------------------------------------------------------
// Catalog actions (public - no auth required)
// ---------------------------------------------------------------------------

export async function getPublicCatalog(
  orgSlug: string,
): Promise<ActionResult<CatalogWithProducts[]>> {
  const supabase = await createSupabaseServerClient();

  // Get organization ID
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();

  if (!org) {
    return err("not_found", "Organization not found");
  }

  // Get categories with active products
  const { data: categories, error } = await supabase
    .from("categories")
    .select(
      `
      *,
      products:products(
        *,
        variants:product_variants(*)
      )
    `,
    )
    .eq("organization_id", org.id)
    .eq("is_active", true)
    .order("display_order");

  if (error) {
    return err("internal", "Failed to fetch catalog");
  }

  // Filter to only active products with available variants
  const filtered = categories
    ?.map((cat) => ({
      ...cat,
      products: cat.products?.filter(
        (p: Product & { variants?: ProductVariant[] }) =>
          p.is_active && p.variants?.some((v: ProductVariant) => v.is_available),
      ),
    }))
    .filter((cat) => cat.products?.length > 0);

  return ok(filtered as CatalogWithProducts[]);
}

export async function getProductForBuyer(
  productId: string,
): Promise<ActionResult<(Product & { variants: ProductVariant[]; category: Category })>> {
  const supabase = await createSupabaseServerClient();

  const { data: product, error } = await supabase
    .from("products")
    .select(
      `
      *,
      variants:product_variants(*),
      category:categories(*)
    `,
    )
    .eq("id", productId)
    .eq("is_active", true)
    .single();

  if (error || !product) {
    return err("not_found", "Product not found");
  }

  // Filter to available variants
  const filtered = {
    ...product,
    variants: product.variants?.filter((v: ProductVariant) => v.is_available),
  };

  return ok(filtered as Product & { variants: ProductVariant[]; category: Category });
}

// ---------------------------------------------------------------------------
// Buyer profile actions
// ---------------------------------------------------------------------------

export async function getBuyerProfile(): Promise<ActionResult<Buyer>> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("unauthenticated", "Not authenticated");
  }

  const { data: buyer, error } = await supabase
    .from("buyers")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !buyer) {
    return err("validation", "Buyer profile not found");
  }

  return ok(buyer as Buyer);
}

const UpdateProfileInput = z.object({
  displayName: z.string().min(1).max(150).optional(),
  phone: z.string().min(5).max(20).optional(),
  address: z.string().max(500).optional(),
});

export async function updateBuyerProfile(
  rawInput: unknown,
): Promise<ActionResult<Buyer>> {
  const parsed = UpdateProfileInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input");
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("unauthenticated", "Not authenticated");
  }

  const updates: Partial<Buyer> = {};
  if (input.displayName) updates.display_name = input.displayName;
  if (input.phone !== undefined) updates.phone = input.phone || null;
  if (input.address !== undefined) updates.address = input.address || null;

  const { data: buyer, error } = await supabase
    .from("buyers")
    .update(updates)
    .eq("id", user.id)
    .select()
    .single();

  if (error || !buyer) {
    return err("internal", "Failed to update profile");
  }

  return ok(buyer as Buyer);
}
