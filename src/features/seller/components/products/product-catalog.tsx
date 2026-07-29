"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Category, ProductVariant } from "@/features/seller/types";
import {
  countByCategory,
  filterByCategory,
  sortCategories,
  type CatalogProduct,
} from "@/features/seller/lib/catalog-model";
import { SellerProductCard } from "./product-card";

type ProductCatalogProps = {
  categories: Category[];
  products: CatalogProduct[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onEditProduct: (product: CatalogProduct) => void;
  onDeleteProduct: (product: CatalogProduct) => void;
  onAddVariant: (product: CatalogProduct) => void;
  onEditVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onDeleteVariant: (product: CatalogProduct, variant: ProductVariant) => void;
};

export function ProductCatalog({
  categories,
  products,
  selectedCategoryId,
  onSelectCategory,
  onEditCategory,
  onDeleteCategory,
  onEditProduct,
  onDeleteProduct,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
}: ProductCatalogProps) {
  const sorted = sortCategories(categories);
  const counts = countByCategory(products);
  const visible = filterByCategory(products, selectedCategoryId);
  const selected = sorted.find((c) => c.id === selectedCategoryId) ?? null;

  return (
    <div className="space-y-4">
      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={selectedCategoryId === null ? "default" : "outline"}
          size="sm"
          onClick={() => onSelectCategory(null)}
        >
          All ({products.length})
        </Button>
        {sorted.map((category) => (
          <Button
            key={category.id}
            variant={selectedCategoryId === category.id ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectCategory(category.id)}
          >
            {category.name} ({counts.get(category.id) ?? 0})
          </Button>
        ))}
      </div>

      {/* Selected-category actions */}
      {selected && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {selected.name}
            {selected.description ? ` — ${selected.description}` : ""}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEditCategory(selected)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDeleteCategory(selected)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      )}

      {/* Grid */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {categories.length === 0
            ? "Create your first category, then add products to it."
            : "No products in this category yet. Click “Add Product” to create one."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((product) => (
            <SellerProductCard
              key={product.id}
              product={product}
              onEdit={() => onEditProduct(product)}
              onDelete={() => onDeleteProduct(product)}
              onAddVariant={() => onAddVariant(product)}
              onEditVariant={(variant) => onEditVariant(product, variant)}
              onDeleteVariant={(variant) => onDeleteVariant(product, variant)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
