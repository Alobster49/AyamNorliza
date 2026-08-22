import type { Database } from "@/types/database.generated";

export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type CategoryInsert = Database["public"]["Tables"]["categories"]["Insert"];
export type CategoryUpdate = Database["public"]["Tables"]["categories"]["Update"];

export type Product = Database["public"]["Tables"]["products"]["Row"];
export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
export type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export type ProductVariant = Database["public"]["Tables"]["product_variants"]["Row"];
export type ProductVariantInsert = Database["public"]["Tables"]["product_variants"]["Insert"];
export type ProductVariantUpdate = Database["public"]["Tables"]["product_variants"]["Update"];

export type Customer = Database["public"]["Tables"]["customers"]["Row"];
export type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
export type CustomerUpdate = Database["public"]["Tables"]["customers"]["Update"];
export type CustomerWithPortal = Customer & { has_portal_account: boolean };

export type CatalogWithProducts = Category & {
  products: (Product & { variants: ProductVariant[] })[];
};

export type UnitType = "per_kg" | "per_piece";

export const UNIT_TYPES: readonly UnitType[] = ["per_kg", "per_piece"] as const;

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  per_kg: "Per kg",
  per_piece: "Per piece",
};
