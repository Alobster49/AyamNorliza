/**
 * Buyer feature types and schemas.
 */

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
  price_per_unit: number;
  unit_type: "per_kg" | "per_piece";
  is_available: boolean;
};

export type CatalogCategory = Category & {
  products: (Product & { variants: ProductVariant[] })[];
};

export type CatalogWithProducts = Category & {
  products: (Product & { variants?: ProductVariant[] })[];
};
