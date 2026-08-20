"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { Category, ProductVariant } from "@/features/seller/types";
import {
  countByCategory,
  filterByCategory,
  sortCategories,
  type CatalogProduct,
} from "@/features/seller/lib/catalog-model";
import { CategoryRail } from "./category-rail";
import { ProductLedger } from "./product-ledger";
import { SellerProductCard } from "./product-card";

export type CatalogView = "cards" | "ledger";

const VIEW_STORAGE_KEY = "seller-catalog-view";

type ProductCatalogProps = {
  categories: Category[];
  products: CatalogProduct[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  onAddCategory: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onEditProduct: (product: CatalogProduct) => void;
  onDeleteProduct: (product: CatalogProduct) => void;
  onAddVariant: (product: CatalogProduct) => void;
  onEditVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onDeleteVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onToggleVariant: (product: CatalogProduct, variant: ProductVariant) => void;
};

export function ProductCatalog({
  categories,
  products,
  selectedCategoryId,
  onSelectCategory,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onEditProduct,
  onDeleteProduct,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
  onToggleVariant,
}: ProductCatalogProps) {
  // Default to cards; restore the device's last choice after mount so the
  // server render never mismatches.
  const [view, setView] = useState<CatalogView>("cards");
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage restore; a lazy initializer would mismatch the SSR render
    if (stored === "cards" || stored === "ledger") setView(stored);
  }, []);

  const changeView = (next: CatalogView) => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  const sorted = sortCategories(categories);
  const counts = countByCategory(products);
  const visible = filterByCategory(products, selectedCategoryId);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <CategoryRail
        categories={sorted}
        counts={counts}
        totalCount={products.length}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={onSelectCategory}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onDeleteCategory={onDeleteCategory}
      />

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex justify-end">
          <div
            role="group"
            aria-label="Catalog view"
            className="inline-flex gap-0.5 rounded-lg border bg-muted p-0.5"
          >
            <ViewButton
              active={view === "cards"}
              onClick={() => changeView("cards")}
              icon={<LayoutGrid className="h-3.5 w-3.5" />}
              label="Cards"
            />
            <ViewButton
              active={view === "ledger"}
              onClick={() => changeView("ledger")}
              icon={<Rows3 className="h-3.5 w-3.5" />}
              label="Ledger"
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            {categories.length === 0
              ? "Create your first category, then add products to it."
              : "No products in this category yet. Click “Add Product” to create one."}
          </div>
        ) : view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {visible.map((product) => (
              <SellerProductCard
                key={product.id}
                product={product}
                onEdit={() => onEditProduct(product)}
                onDelete={() => onDeleteProduct(product)}
                onAddVariant={() => onAddVariant(product)}
                onEditVariant={(variant) => onEditVariant(product, variant)}
                onDeleteVariant={(variant) => onDeleteVariant(product, variant)}
                onToggleVariant={(variant) => onToggleVariant(product, variant)}
              />
            ))}
          </div>
        ) : (
          <ProductLedger
            products={visible}
            onEditProduct={onEditProduct}
            onDeleteProduct={onDeleteProduct}
            onAddVariant={onAddVariant}
            onEditVariant={onEditVariant}
            onDeleteVariant={onDeleteVariant}
            onToggleVariant={onToggleVariant}
          />
        )}
      </div>
    </div>
  );
}

type ViewButtonProps = {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
};

function ViewButton({ active, onClick, icon, label }: ViewButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
