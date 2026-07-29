/**
 * Buyer portal server actions.
 * Handles catalog browsing, order management, and profile updates.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/identity-access/server/actions";
import type {
  Buyer,
  BuyerOrder,
  BuyerOrderItem,
  Category,
  Product,
  ProductVariant,
  CatalogWithProducts,
  OrderWithItems,
  CartItem,
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

// ---------------------------------------------------------------------------
// Order actions
// ---------------------------------------------------------------------------

export async function getBuyerOrders(): Promise<ActionResult<BuyerOrder[]>> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("unauthenticated", "Not authenticated");
  }

  const { data: orders, error } = await supabase
    .from("buyer_orders")
    .select("*")
    .eq("buyer_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return err("internal", "Failed to fetch orders");
  }

  return ok((orders ?? []) as BuyerOrder[]);
}

export async function getBuyerOrderWithItems(
  orderId: string,
): Promise<ActionResult<OrderWithItems>> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("unauthenticated", "Not authenticated");
  }

  const { data: order, error } = await supabase
    .from("buyer_orders")
    .select("*")
    .eq("id", orderId)
    .eq("buyer_id", user.id)
    .single();

  if (error || !order) {
    return err("not_found", "Order not found");
  }

  const { data: items } = await supabase
    .from("buyer_order_items")
    .select(
      `
      *,
      variant:product_variants(
        *,
        product:products(*)
      )
    `,
    )
    .eq("order_id", orderId);

  return ok({
    ...order,
    items: (items ?? []) as OrderWithItems["items"],
  } as OrderWithItems);
}

const CreateOrderInput = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().positive().max(10000),
      }),
    )
    .min(1),
  deliveryAddress: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export async function createBuyerOrder(
  rawInput: unknown,
): Promise<ActionResult<BuyerOrder>> {
  const parsed = CreateOrderInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid order data");
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("unauthenticated", "Not authenticated");
  }

  // Get buyer record to find organization
  const { data: buyer, error: buyerError } = await supabase
    .from("buyers")
    .select("id, organization_id, address")
    .eq("id", user.id)
    .single();

  if (buyerError || !buyer) {
    return err("validation", "Buyer not found");
  }

  // Get variant details and calculate totals
  const variantIds = input.items.map((i) => i.variantId);
  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, price_per_unit, unit_type, product_id, is_available")
    .in("id", variantIds);

  if (!variants || variants.length !== variantIds.length) {
    return err("validation", "Some products are not available");
  }

  const variantMap = new Map(variants.map((v) => [v.id, v]));

  // Calculate total
  let totalAmount = 0;
  const orderItems: Omit<BuyerOrderItem, "id" | "order_id" | "created_at">[] = [];

  for (const item of input.items) {
    const variant = variantMap.get(item.variantId);
    if (!variant || !variant.is_available) {
      return err("validation", `Product is not available`);
    }
    if (variant.unit_type === "per_piece" && !Number.isInteger(item.quantity)) {
      return err("validation", "Piece quantities must be whole numbers");
    }
    const subtotal = Math.round(Number(variant.price_per_unit) * item.quantity * 100) / 100;
    totalAmount += subtotal;
    orderItems.push({
      variant_id: variant.id,
      quantity: item.quantity,
      unit_price: variant.price_per_unit,
      subtotal,
    });
  }

  // Create order
  const { data: order, error: orderError } = await supabase
    .from("buyer_orders")
    .insert({
      buyer_id: buyer.id,
      organization_id: buyer.organization_id,
      total_amount: totalAmount,
      delivery_address: input.deliveryAddress ?? buyer.address ?? null,
      notes: input.notes ?? null,
      status: "new",
    })
    .select()
    .single();

  if (orderError || !order) {
    return err("internal", "Failed to create order");
  }

  // Insert order items
  const itemsWithOrderId = orderItems.map((item) => ({
    ...item,
    order_id: order.id,
  }));

  const { error: itemsError } = await supabase
    .from("buyer_order_items")
    .insert(itemsWithOrderId);

  if (itemsError) {
    // Rollback: delete the order
    await supabase.from("buyer_orders").delete().eq("id", order.id);
    return err("internal", "Failed to create order items");
  }

  revalidatePath("/orders");
  revalidatePath("/checkout");

  return ok(order as BuyerOrder);
}
