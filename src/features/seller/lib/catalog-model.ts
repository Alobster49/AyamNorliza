/**
 * Pure helpers for the seller catalog grid: grouping, filtering, sorting.
 */

import type { Category, Product, ProductVariant } from "../types";
import { formatPrice } from "./pricing";

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

/** "RM 9.50 – RM 16.00 · 3 sizes", or null when the product has no variants. */
export function priceRangeLabel(product: CatalogProduct): string | null {
  if (product.variants.length === 0) return null;
  const prices = product.variants.map((v) => Number(v.price_per_unit));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const sizes = `${product.variants.length} ${product.variants.length === 1 ? "size" : "sizes"}`;
  const range = min === max ? formatPrice(min) : `${formatPrice(min)} – ${formatPrice(max)}`;
  return `${range} · ${sizes}`;
}

export type CatalogSummary = {
  productCount: number;
  variantCount: number;
  soldOutCount: number;
};

export function catalogSummary(products: CatalogProduct[]): CatalogSummary {
  let variantCount = 0;
  let soldOutCount = 0;
  for (const p of products) {
    variantCount += p.variants.length;
    soldOutCount += p.variants.filter((v) => !v.is_available).length;
  }
  return { productCount: products.length, variantCount, soldOutCount };
}
