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

/**
 * Archived products (is_active = false) are hidden from the buyer portal and
 * from every seller view except the archive itself.
 */
export const ARCHIVED_VIEW = "archived" as const;

/** null = all live products, "archived" = the archive, otherwise a category id. */
export type CatalogFilter = string | null;

export function filterCatalog(
  products: CatalogProduct[],
  filter: CatalogFilter,
): CatalogProduct[] {
  if (filter === ARCHIVED_VIEW) return products.filter((p) => !p.is_active);
  const live = products.filter((p) => p.is_active);
  return filter === null ? live : live.filter((p) => p.category_id === filter);
}

export function countArchived(products: CatalogProduct[]): number {
  return products.filter((p) => !p.is_active).length;
}

/** Counts only live products, matching what the category views actually show. */
export function countByCategory(products: CatalogProduct[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of products) {
    if (!p.is_active) continue;
    counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  }
  return counts;
}

export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
  );
}

/**
 * Formatted price range plus variant count, or null when the product has no
 * variants. The caller renders the count through its own (localized) message.
 */
export function priceRange(
  product: CatalogProduct,
): { range: string; count: number } | null {
  if (product.variants.length === 0) return null;
  const prices = product.variants.map((v) => Number(v.price_per_unit));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = min === max ? formatPrice(min) : `${formatPrice(min)} – ${formatPrice(max)}`;
  return { range, count: product.variants.length };
}

/** "RM 9.50 – RM 16.00 · 3 sizes", or null when the product has no variants. */
export function priceRangeLabel(product: CatalogProduct): string | null {
  const parts = priceRange(product);
  if (!parts) return null;
  return `${parts.range} · ${parts.count} ${parts.count === 1 ? "size" : "sizes"}`;
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
