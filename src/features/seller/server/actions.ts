"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import { requireAnyPermission, requirePermission } from "@/lib/auth/require-permission";
import type { PermissionAction } from "@/lib/auth/rbac";
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

/**
 * Every action here takes the organization *slug* and resolves the org id
 * through `requirePermission`, which throws `OrderPermissionError` when the
 * caller is not an active member holding the (resource, action) grant. The
 * id is never accepted from the client: a caller who could pass one could
 * otherwise aim a write at another org, and the app should refuse that
 * itself rather than leaning on RLS to catch it.
 *
 * Row-targeted updates and deletes additionally filter on
 * `organization_id`, so a guessed row id from another org matches nothing.
 */
async function guard(organizationSlug: string, resource: string, action: PermissionAction) {
  const { orgId, userId } = await requirePermission(organizationSlug, resource, action);
  return { orgId, userId };
}

/**
 * The catalog read the new-order screen needs before an order exists. That
 * page gates itself on `orders:add`, so requiring `products:view` here
 * would break order-taking for a custom role given orders but not the
 * catalog page. Safe to widen because the `products` and `categories`
 * SELECT policies admit any active member.
 *
 * Deliberately not used for customers: `customers_select` requires
 * `customers:view` since 20260901000006, so widening the guard there would
 * only trade a clear refusal for a silently empty result list.
 */
async function guardForOrderTaking(organizationSlug: string, resource: "products") {
  const { orgId } = await requireAnyPermission(organizationSlug, [
    [resource, "view"],
    ["orders", "add"],
  ]);
  return { orgId };
}

/**
 * Postgres error text is internal detail (constraint names, column names),
 * and Next.js redacts uncaught Server Action messages in production anyway.
 * Known constraint violations get a message the seller can act on; anything
 * else surfaces as a generic failure.
 */
function dbError(error: { code?: string; message: string }, fallback: string): Error {
  if (error.code === "23505") return new Error("That name is already used. Pick a different one.");
  if (error.code === "PGRST116") return new Error("That record no longer exists.");
  return new Error(fallback);
}

function revalidateSellerPath(orgSlug: string, page: string) {
  revalidatePath(`/${orgSlug}/${page}`);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export async function getCategories(organizationSlug: string) {
  const { orgId } = await guard(organizationSlug, "products", "view");
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("organization_id", orgId)
    .order("display_order", { ascending: true });
  return data ?? [];
}

export async function createCategory(
  organizationSlug: string,
  input: Omit<CategoryInsert, "organization_id">,
) {
  const { orgId } = await guard(organizationSlug, "products", "add");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw dbError(error, "Could not create the category.");
  revalidateSellerPath(organizationSlug, "products");
  return data;
}

export async function updateCategory(
  organizationSlug: string,
  id: string,
  input: CategoryUpdate,
) {
  const { orgId } = await guard(organizationSlug, "products", "edit");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update(input)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw dbError(error, "Could not update the category.");
  revalidateSellerPath(organizationSlug, "products");
  return data;
}

export async function deleteCategory(organizationSlug: string, id: string) {
  const { orgId } = await guard(organizationSlug, "products", "delete");
  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) {
    if (error.code === "23503") {
      throw new Error("This category still has products. Move or delete them first.");
    }
    throw dbError(error, "Could not delete the category.");
  }
  revalidateSellerPath(organizationSlug, "products");
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export async function getProducts(organizationSlug: string) {
  const { orgId } = await guard(organizationSlug, "products", "view");
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*, category:categories(*), variants:product_variants(*)")
    .eq("organization_id", orgId)
    .order("name");
  return data ?? [];
}

export async function createProduct(
  organizationSlug: string,
  input: Omit<ProductInsert, "organization_id">,
) {
  const { orgId } = await guard(organizationSlug, "products", "add");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw dbError(error, "Could not create the product.");
  revalidateSellerPath(organizationSlug, "products");
  return data;
}

export async function updateProduct(
  organizationSlug: string,
  id: string,
  input: ProductUpdate,
) {
  const { orgId } = await guard(organizationSlug, "products", "edit");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update(input)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw dbError(error, "Could not update the product.");
  revalidateSellerPath(organizationSlug, "products");
  return data;
}

/**
 * Archiving is the normal way to retire a product: it disappears from the buyer
 * portal and the seller's live catalog, but every past order line still points
 * at a row that exists. Hard delete stays available only for products that have
 * never been ordered (enforced by order_items.product_id ON DELETE RESTRICT).
 */
export async function setProductArchived(
  organizationSlug: string,
  id: string,
  archived: boolean,
) {
  const { orgId } = await guard(organizationSlug, "products", "edit");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: !archived })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw dbError(error, "Could not update the product.");
  revalidateSellerPath(organizationSlug, "products");
  return data;
}

/**
 * How many historical order lines reference this product. `order_items` has
 * no `organization_id` of its own, so the product is confirmed to belong to
 * the caller's org before the count runs.
 */
export async function countProductOrderItems(
  organizationSlug: string,
  id: string,
): Promise<number> {
  const { orgId } = await guard(organizationSlug, "products", "view");
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!product) throw new Error("That product no longer exists.");

  const { count, error } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);

  if (error) throw dbError(error, "Could not check this product's order history.");
  return count ?? 0;
}

export async function deleteProduct(organizationSlug: string, id: string) {
  const { orgId } = await guard(organizationSlug, "products", "delete");
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "This product has past orders, so deleting it would destroy order history. Archive it instead — it disappears from the shop but the orders stay intact.",
      );
    }
    throw dbError(error, "Could not delete the product.");
  }
  revalidateSellerPath(organizationSlug, "products");
}

// ---------------------------------------------------------------------------
// Product Variants
// ---------------------------------------------------------------------------
export async function createVariant(
  organizationSlug: string,
  input: Omit<ProductVariantInsert, "organization_id">,
) {
  const { orgId } = await guard(organizationSlug, "products", "add");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw dbError(error, "Could not create the size/option.");
  revalidateSellerPath(organizationSlug, "products");
  return data;
}

export async function updateVariant(
  organizationSlug: string,
  id: string,
  input: ProductVariantUpdate,
) {
  const { orgId } = await guard(organizationSlug, "products", "edit");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .update(input)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw dbError(error, "Could not update the size/option.");
  revalidateSellerPath(organizationSlug, "products");
  return data;
}

export async function deleteVariant(organizationSlug: string, id: string) {
  const { orgId } = await guard(organizationSlug, "products", "delete");
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "This size/option has been ordered before and cannot be deleted. Mark it unavailable instead.",
      );
    }
    throw dbError(error, "Could not delete the size/option.");
  }
  revalidateSellerPath(organizationSlug, "products");
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export async function getCustomers(organizationSlug: string): Promise<CustomerWithPortal[]> {
  const { orgId } = await guard(organizationSlug, "customers", "view");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*, buyers(id)")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw dbError(error, "Could not load customers.");
  return (data ?? []).map(({ buyers, ...customer }) => ({
    ...customer,
    has_portal_account: (buyers?.length ?? 0) > 0,
  }));
}

/**
 * PostgREST parses `or()` as filter syntax, so raw search text could inject
 * extra filter terms (a comma starts a new one, a quote ends a value).
 * Wrapping the pattern in double quotes makes the whole thing one literal
 * value; the backslash/quote escape keeps the wrapper from being closed
 * early. `%`/`_` are left alone — they only widen the searcher's own match.
 */
function quoteSearchPattern(query: string): string {
  return `"%${query.replace(/[\\"]/g, (c) => `\\${c}`)}%"`;
}

export async function searchCustomers(organizationSlug: string, query: string) {
  const { orgId } = await guard(organizationSlug, "customers", "view");
  const supabase = await createClient();
  const pattern = quoteSearchPattern(query.slice(0, 100));
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("organization_id", orgId)
    .or(`name.ilike.${pattern},phone.ilike.${pattern}`)
    .limit(10);
  return data ?? [];
}

export async function createCustomer(
  organizationSlug: string,
  input: Omit<CustomerInsert, "organization_id" | "created_by">,
) {
  const { orgId, userId } = await guard(organizationSlug, "customers", "add");
  const supabase = await createClient();

  const email = parseCustomerEmail(input.email);
  const address = parseCustomerAddress(input);

  const { data, error } = await supabase
    .from("customers")
    .insert({ ...input, email, ...address, organization_id: orgId, created_by: userId })
    .select()
    .single();

  if (error) throw dbError(error, "Could not create the customer.");
  revalidateSellerPath(organizationSlug, "customers");
  return data;
}

export async function updateCustomer(
  organizationSlug: string,
  id: string,
  input: CustomerUpdate,
) {
  const { orgId } = await guard(organizationSlug, "customers", "edit");
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
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw dbError(error, "Could not update the customer.");
  revalidateSellerPath(organizationSlug, "customers");
  return data;
}

export async function deleteCustomer(organizationSlug: string, id: string) {
  const { orgId } = await guard(organizationSlug, "customers", "delete");
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw dbError(error, "Could not delete the customer.");
  revalidateSellerPath(organizationSlug, "customers");
}

export async function getCatalogForOrdering(organizationSlug: string) {
  const { orgId } = await guardForOrderTaking(organizationSlug, "products");
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
