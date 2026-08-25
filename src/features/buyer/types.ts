/**
 * Buyer feature types and schemas.
 */

import type { OrderFallback } from "@/features/orders/types";

/** Message keys (relative to the `buyer.product` namespace) for the buyer-facing
 *  fallback labels. FALLBACK_LABELS in orders/types.ts is shared with the seller
 *  UI and must not change. */
export const BUYER_FALLBACK_KEYS: Record<OrderFallback, string> = {
  cancel: "fallback.cancel",
  mix: "fallback.mix",
  upsize: "fallback.upsize",
  downsize: "fallback.downsize",
};

// Database types
export type Buyer = {
  id: string;
  organization_id: string;
  display_name: string;
  address: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

export type Product = {
  id: string;
  organization_id: string;
  category_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
};

export type ProductVariant = {
  id: string;
  organization_id: string;
  product_id: string;
  name: string;
  unit_type: "per_kg" | "per_piece";
  is_available: boolean;
};

export type CatalogCategory = Category & {
  products: (Product & { variants: ProductVariant[] })[];
};

export type CatalogWithProducts = Category & {
  products: (Product & { variants?: ProductVariant[] })[];
};

export type BuyerAddress = {
  id: string;
  addressLine: string;
  postcode: string;
  state: string;
  area: string;
  isDefault: boolean;
  createdAt: string;
};
