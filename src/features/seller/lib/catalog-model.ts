/**
 * Pure helpers for the seller catalog grid: grouping, filtering, sorting.
 */

import type { Category, Product, ProductVariant } from "../types";

export type CatalogProduct = Product & {
  variants: ProductVariant[];
  category?: Category | null;
};

export function filterByCategory(
  products: CatalogProduct[],
  categoryId: string | null,
): CatalogProduct[] {
  if (categoryId === null) return products;
  return products.filter((p) => p.category_id === categoryId);
}

export function countByCategory(products: CatalogProduct[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of products) {
    counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  }
  return counts;
}

export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
  );
}
