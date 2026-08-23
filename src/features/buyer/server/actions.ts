/**
 * Buyer portal server actions.
 * Handles catalog browsing, order management, and profile updates.
 */

"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Buyer,
  Category,
  Product,
  ProductVariant,
  CatalogWithProducts,
} from "../types";

type CatalogErrorCode = "validation" | "not_found" | "internal" | "unauthenticated";

/**
 * Same shape as the shared `ActionResult`, except the failure branch carries
 * a `messageKey` (a full path under `errors.buyer.*`) instead of prose, so
 * client consumers resolve it with `useTranslations()` + `t(messageKey)`.
 */
type BuyerActionResult<T = never> =
  | { ok: true; data: T }
  | { ok: false; code: CatalogErrorCode; messageKey: string };

function err<T = never>(
  code: CatalogErrorCode,
  messageKey: string,
): BuyerActionResult<T> {
  return { ok: false, code, messageKey };
}

function ok<T>(data: T): BuyerActionResult<T> {
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
): Promise<BuyerActionResult<CatalogWithProducts[]>> {
  const supabase = await createSupabaseServerClient();

  // Get organization ID
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();

  if (!org) {
    return err("not_found", "errors.buyer.catalog.orgNotFound");
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
    return err("internal", "errors.buyer.catalog.fetchFailed");
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
): Promise<BuyerActionResult<(Product & { variants: ProductVariant[]; category: Category })>> {
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
    return err("not_found", "errors.buyer.catalog.productNotFound");
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

export async function getBuyerProfile(): Promise<BuyerActionResult<Buyer>> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("unauthenticated", "errors.buyer.profile.unauthenticated");
  }

  const { data: buyer, error } = await supabase
    .from("buyers")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !buyer) {
    return err("validation", "errors.buyer.profile.notFound");
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
): Promise<BuyerActionResult<Buyer>> {
  const parsed = UpdateProfileInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "errors.buyer.profile.invalidInput");
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("unauthenticated", "errors.buyer.profile.unauthenticated");
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
    return err("internal", "errors.buyer.profile.updateFailed");
  }

  return ok(buyer as Buyer);
}
