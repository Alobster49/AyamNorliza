"use client";

import { useTranslations } from "next-intl";
import type { Category, ProductVariant } from "@/features/seller/types";
import {
  ARCHIVED_VIEW,
  countArchived,
  countByCategory,
  filterCatalog,
  sortCategories,
  type CatalogFilter,
  type CatalogProduct,
} from "@/features/seller/lib/catalog-model";
import { Button } from "@/components/ui/button";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { CategoryRail } from "./category-rail";
import { ProductLedger } from "./product-ledger";
import { SellerProductCard } from "./product-card";

export type CatalogView = "cards" | "ledger";

type ProductCatalogProps = {
  categories: Category[];
  products: CatalogProduct[];
  selectedCategoryId: CatalogFilter;
  view: CatalogView;
  onSelectCategory: (filter: CatalogFilter) => void;
  onAddCategory: () => void;
  onAddProduct: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onEditProduct: (product: CatalogProduct) => void;
  onDeleteProduct: (product: CatalogProduct) => void;
  onArchiveProduct: (product: CatalogProduct) => void;
  onRestoreProduct: (product: CatalogProduct) => void;
  onAddVariant: (product: CatalogProduct) => void;
  onEditVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onDeleteVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onToggleVariant: (product: CatalogProduct, variant: ProductVariant) => void;
};

export function ProductCatalog({
  categories,
  products,
  selectedCategoryId,
  view,
  onSelectCategory,
  onAddCategory,
  onAddProduct,
  onEditCategory,
  onDeleteCategory,
  onEditProduct,
  onDeleteProduct,
  onArchiveProduct,
  onRestoreProduct,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
  onToggleVariant,
}: ProductCatalogProps) {
  const t = useTranslations("seller.products.catalog");
  const sorted = sortCategories(categories);
  const counts = countByCategory(products);
  const archivedCount = countArchived(products);
  const visible = filterCatalog(products, selectedCategoryId);
  const viewingArchive = selectedCategoryId === ARCHIVED_VIEW;

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <CategoryRail
        categories={sorted}
        counts={counts}
        totalCount={products.length - archivedCount}
        archivedCount={archivedCount}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={onSelectCategory}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onDeleteCategory={onDeleteCategory}
      />

      <div className="min-w-0 flex-1 space-y-3">
        {viewingArchive && visible.length > 0 && (
          <p className="rounded-lg border border-dashed bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            {t("archivedNotice")}
          </p>
        )}

        {visible.length === 0 ? (
          <div className="animate-catalog-in rounded-lg border border-dashed px-6 py-12">
            {viewingArchive ? (
              <HenEmptyState title={t("emptyArchivedTitle")} subtitle={t("emptyArchived")} />
            ) : categories.length === 0 ? (
              <div className="flex flex-col items-center gap-5">
                <HenEmptyState
                  title={t("emptyNoCategoriesTitle")}
                  subtitle={t("emptyNoCategories")}
                />
                <Button variant="outline" onClick={onAddCategory}>
                  {t("emptyCreateCategoryCta")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-5">
                <HenEmptyState
                  title={t("emptyNoProductsTitle")}
                  subtitle={t("emptyNoProducts")}
                />
                <Button variant="outline" onClick={onAddProduct}>
                  {t("emptyAddProductCta")}
                </Button>
              </div>
            )}
          </div>
        ) : view === "cards" ? (
          // Keyed by filter so switching categories re-runs the entrance fade —
          // a quick cue that the content under the cursor actually changed.
          <div
            key={`cards-${String(selectedCategoryId)}`}
            className="animate-catalog-in grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4"
          >
            {visible.map((product) => (
              <SellerProductCard
                key={product.id}
                product={product}
                onEdit={() => onEditProduct(product)}
                onDelete={() => onDeleteProduct(product)}
                onArchive={() => onArchiveProduct(product)}
                onRestore={() => onRestoreProduct(product)}
                onAddVariant={() => onAddVariant(product)}
                onEditVariant={(variant) => onEditVariant(product, variant)}
                onDeleteVariant={(variant) => onDeleteVariant(product, variant)}
                onToggleVariant={(variant) => onToggleVariant(product, variant)}
              />
            ))}
          </div>
        ) : (
          <div key={`ledger-${String(selectedCategoryId)}`} className="animate-catalog-in">
            <ProductLedger
              products={visible}
              onEditProduct={onEditProduct}
              onDeleteProduct={onDeleteProduct}
              onArchiveProduct={onArchiveProduct}
              onRestoreProduct={onRestoreProduct}
              onAddVariant={onAddVariant}
              onEditVariant={onEditVariant}
              onDeleteVariant={onDeleteVariant}
              onToggleVariant={onToggleVariant}
            />
          </div>
        )}
      </div>
    </div>
  );
}
