"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import { parseCustomerAddress, parseCustomerEmail } from "../lib/customer-schema";
import type {
  CategoryInsert,
  CategoryUpdate,
  ProductInsert,
  ProductUpdate,
  ProductVariantInsert,
  ProductVariantUpdate,
  CustomerInsert,
  CustomerUpdate,
  CustomerWithPortal,
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

/**
 * Archiving is the normal way to retire a product: it disappears from the buyer
 * portal and the seller's live catalog, but every past order line still points
 * at a row that exists. Hard delete stays available only for products that have
 * never been ordered (enforced by order_items.product_id ON DELETE RESTRICT).
 */
export async function setProductArchived(id: string, archived: boolean, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: !archived })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

/** How many historical order lines reference this product. */
export async function countProductOrderItems(id: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function deleteProduct(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "This product has past orders, so deleting it would destroy order history. Archive it instead — it disappears from the shop but the orders stay intact.",
      );
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
export async function getCustomers(orgId: string): Promise<CustomerWithPortal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*, buyers(id)")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ buyers, ...customer }) => ({
    ...customer,
    has_portal_account: (buyers?.length ?? 0) > 0,
  }));
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

  const email = parseCustomerEmail(input.email);
  const address = parseCustomerAddress(input);

  const { data, error } = await supabase
    .from("customers")
    .insert({ ...input, email, ...address, organization_id: orgId, created_by: user.user.id })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "customers");
  return data;
}

export async function updateCustomer(id: string, input: CustomerUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const touchesAddress =
    "address" in input || "postcode" in input || "state" in input || "area" in input;
  const patch = {
    ...input,
    ...("email" in input ? { email: parseCustomerEmail(input.email) } : {}),
    ...(touchesAddress ? parseCustomerAddress(input) : {}),
  };

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
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
