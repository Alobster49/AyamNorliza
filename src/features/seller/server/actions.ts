"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import type {
  CategoryInsert,
  CategoryUpdate,
  ProductInsert,
  ProductUpdate,
  ProductVariantInsert,
  ProductVariantUpdate,
  CustomerInsert,
  CustomerUpdate,
  OrderInsert,
  OrderUpdate,
  OrderItemInsert,
} from "../types";

export async function getOrganizationId(orgSlug: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .single();
  return data?.id ?? null;
}

export async function requireSellerRole(orgSlug: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const orgId = await getOrganizationId(orgSlug);
  if (!orgId) return false;

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  return !!member && ["owner", "org_admin", "seller"].includes(member.role);
}

function revalidateSellerPath(orgSlug: string | undefined, page: string) {
  if (orgSlug) revalidatePath(`/${orgSlug}/${page}`);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export async function getCategories(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("organization_id", orgId)
    .order("display_order", { ascending: true });
  return data ?? [];
}

export async function createCategory(
  orgId: string,
  input: Omit<CategoryInsert, "organization_id">,
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function updateCategory(id: string, input: CategoryUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function deleteCategory(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("This category still has products. Move or delete them first.");
    }
    throw new Error(error.message);
  }
  revalidateSellerPath(orgSlug, "products");
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export async function getProducts(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*, category:categories(*), variants:product_variants(*)")
    .eq("organization_id", orgId)
    .order("name");
  return data ?? [];
}

export async function getProductWithVariants(productId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*, category:categories(*), variants:product_variants(*)")
    .eq("id", productId)
    .single();
  return data;
}

export async function createProduct(
  orgId: string,
  input: Omit<ProductInsert, "organization_id">,
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function updateProduct(id: string, input: ProductUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function deleteProduct(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("This product has been ordered before and cannot be deleted. Mark it inactive instead.");
    }
    throw new Error(error.message);
  }
  revalidateSellerPath(orgSlug, "products");
}

// ---------------------------------------------------------------------------
// Product Variants
// ---------------------------------------------------------------------------
export async function createVariant(
  orgId: string,
  input: Omit<ProductVariantInsert, "organization_id">,
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function updateVariant(id: string, input: ProductVariantUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function deleteVariant(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("This size/option has been ordered before and cannot be deleted. Mark it unavailable instead.");
    }
    throw new Error(error.message);
  }
  revalidateSellerPath(orgSlug, "products");
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export async function getCustomers(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("organization_id", orgId)
    .order("name");
  return data ?? [];
}

export async function searchCustomers(orgId: string, query: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("organization_id", orgId)
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(10);
  return data ?? [];
}

export async function createCustomer(
  orgId: string,
  input: Omit<CustomerInsert, "organization_id" | "created_by">,
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("customers")
    .insert({ ...input, organization_id: orgId, created_by: user.user.id })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "customers");
  return data;
}

export async function updateCustomer(id: string, input: CustomerUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "customers");
  return data;
}

export async function deleteCustomer(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "customers");
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export async function getOrders(orgId: string, status?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(`
      *,
      customer:customers(*)
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data } = await query;
  return data ?? [];
}

export async function getOrderWithItems(orderId: string) {
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select(`
      *,
      customer:customers(*),
      seller:profiles(*),
      items:order_items(
        *,
        variant:product_variants(*)
      )
    `)
    .eq("id", orderId)
    .single();
  return order;
}

export async function createOrder(
  orgId: string,
  orderInput: Omit<OrderInsert, "organization_id" | "seller_id">,
  items: Omit<OrderItemInsert, "order_id">[],
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error("Not authenticated");

  // Calculate total
  const total = items.reduce((sum, item) => sum + Number(item.subtotal), 0);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      ...orderInput,
      organization_id: orgId,
      seller_id: user.user.id,
      total_amount: total,
    })
    .select()
    .single();

  if (orderError) throw new Error(orderError.message);

  // Insert order items
  const itemsWithOrderId = items.map((item) => ({ ...item, order_id: order.id }));
  const { error: itemsError } = await supabase.from("order_items").insert(itemsWithOrderId);

  if (itemsError) throw new Error(itemsError.message);

  revalidateSellerPath(orgSlug, "orders");
  return order;
}

export async function updateOrderStatus(orderId: string, status: string, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "orders");
  revalidateSellerPath(orgSlug, `orders/${orderId}`);
  return data;
}

export async function getCatalogForOrdering(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select(`
      *,
      products:products(
        *,
        variants:product_variants(*)
      )
    `)
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  return data ?? [];
}
